import { purpose, type Database } from '@openreel/db'
import type { SocialOpenreelVideoDefs } from '@openreel/lexicons'
import type { Kysely } from 'kysely'

export interface CommentsQuery {
  /** AT-URI of the video post. */
  uri: string
  /** A top-level comment on the video: page its replies instead. */
  parent?: string
  limit: number
  cursor?: string
}

export interface CommentsPage {
  comments: SocialOpenreelVideoDefs.CommentView[]
  cursor?: string
}

/** The video, or the parent comment asked for, is not indexed. */
export class CommentsNotFoundError extends Error {}

/** A cursor this AppView did not issue. */
export class InvalidCommentsCursorError extends Error {}

/** Keyset cursor over (sort_at, uri): `<epoch ms>::<uri>`, as the feed generator's. */
function encodeCursor(sortAt: Date, uri: string): string {
  return `${sortAt.getTime()}::${uri}`
}

function decodeCursor(cursor: string): { sortAt: Date; uri: string } {
  const sep = cursor.indexOf('::')
  const ms = Number(cursor.slice(0, sep))
  const uri = cursor.slice(sep + 2)
  if (sep < 1 || !Number.isSafeInteger(ms) || !uri.startsWith('at://')) {
    throw new InvalidCommentsCursorError('malformed cursor')
  }
  return { sortAt: new Date(ms), uri }
}

/**
 * One page of a video's comments: top-level comments newest first, or with
 * `parent` that comment's replies oldest first, so a thread reads top down.
 * Throws {@link CommentsNotFoundError} for a video, or parent, that is not
 * indexed (never was, deleted, or removed by moderation).
 */
export async function getComments(
  db: Kysely<Database>,
  params: CommentsQuery,
): Promise<CommentsPage> {
  const after = params.cursor === undefined ? undefined : decodeCursor(params.cursor)

  const video = await purpose('Look up video for comments', () =>
    db.selectFrom('video_post').select('uri').where('uri', '=', params.uri).executeTakeFirst(),
  )
  if (video === undefined) throw new CommentsNotFoundError('video not found')

  if (params.parent !== undefined) {
    const parent = await purpose('Look up parent comment', () =>
      db
        .selectFrom('video_comment')
        .select('uri')
        .where('uri', '=', params.parent ?? '')
        .where('subject_uri', '=', params.uri)
        .where('parent_uri', 'is', null)
        .executeTakeFirst(),
    )
    if (parent === undefined) throw new CommentsNotFoundError('comment not found')
  }

  const replies = params.parent !== undefined
  const direction = replies ? 'asc' : 'desc'
  let query = db
    .selectFrom('video_comment as c')
    .innerJoin('actor as a', 'a.did', 'c.author_did')
    .select([
      'c.uri',
      'c.cid',
      'c.author_did',
      'a.handle',
      'c.record',
      'c.indexed_at',
      'c.sort_at',
      (eb) =>
        eb
          .selectFrom('video_comment as r')
          .select((r) => r.fn.countAll<number>().as('n'))
          .whereRef('r.parent_uri', '=', 'c.uri')
          .as('reply_count'),
    ])
    .orderBy('c.sort_at', direction)
    .orderBy('c.uri', direction)
    .limit(params.limit)
  query = replies
    ? query.where('c.parent_uri', '=', params.parent ?? '')
    : query.where('c.subject_uri', '=', params.uri).where('c.parent_uri', 'is', null)
  if (after !== undefined) {
    const op = replies ? '>' : '<'
    query = query.where((eb) =>
      eb.or([
        eb('c.sort_at', op, after.sortAt),
        eb.and([eb('c.sort_at', '=', after.sortAt), eb('c.uri', op, after.uri)]),
      ]),
    )
  }

  const rows = await purpose(
    replies ? 'Select replies, oldest first' : 'Select comments, newest first',
    () => query.execute(),
  )
  const comments = rows.map((row): SocialOpenreelVideoDefs.CommentView => ({
    uri: row.uri,
    cid: row.cid,
    author: { did: row.author_did, ...(row.handle === null ? {} : { handle: row.handle }) },
    record: row.record,
    // Replies cannot have replies; only top-level comments carry a count.
    ...(replies ? {} : { replyCount: row.reply_count ?? 0 }),
    indexedAt: row.indexed_at.toISOString(),
  }))
  const last = rows.at(-1)
  return {
    comments,
    // A short page is the end.
    ...(last !== undefined && rows.length === params.limit
      ? { cursor: encodeCursor(last.sort_at, last.uri) }
      : {}),
  }
}
