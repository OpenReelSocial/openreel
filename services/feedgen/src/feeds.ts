import type { Database } from '@openreel/db'
import type { Kysely } from 'kysely'

export interface SkeletonPage {
  feed: { post: string }[]
  cursor?: string
}

/** A feed this generator serves, keyed by its generator record's rkey. */
export interface Feed {
  /** Returns one page; `cursor` is whatever the previous page returned. */
  page(db: Kysely<Database>, limit: number, cursor: string | undefined): Promise<SkeletonPage>
}

/** Thrown for a cursor this generator did not issue. */
export class InvalidCursorError extends Error {}

/**
 * Cursor for (sort_at, uri) keyset paging: `<epoch ms>::<uri>`. The URI breaks
 * ties between posts with the same timestamp. sort_at is written from a JS Date
 * in the indexer, so millisecond precision loses nothing.
 */
export function encodeCursor(sortAt: Date, uri: string): string {
  return `${sortAt.getTime()}::${uri}`
}

export function decodeCursor(cursor: string): { sortAt: Date; uri: string } {
  const sep = cursor.indexOf('::')
  const ms = Number(cursor.slice(0, sep))
  const uri = cursor.slice(sep + 2)
  if (sep < 1 || !Number.isSafeInteger(ms) || !uri.startsWith('at://')) {
    throw new InvalidCursorError('malformed cursor')
  }
  return { sortAt: new Date(ms), uri }
}

/**
 * Newest first, no ranking: every indexed video whose media is ready to play.
 * The placeholder until a recommendation algorithm exists (project plan 5.5).
 */
export const recent: Feed = {
  async page(db, limit, cursor) {
    let query = db
      .selectFrom('video_post as p')
      .innerJoin('video_media as m', (join) =>
        join.onRef('m.author_did', '=', 'p.author_did').onRef('m.video_cid', '=', 'p.video_cid'),
      )
      .select(['p.uri', 'p.sort_at'])
      .where('m.status', '=', 'ready')
      .orderBy('p.sort_at', 'desc')
      .orderBy('p.uri', 'desc')
      .limit(limit)

    if (cursor !== undefined) {
      const after = decodeCursor(cursor)
      query = query.where((eb) =>
        eb.or([
          eb('p.sort_at', '<', after.sortAt),
          eb.and([eb('p.sort_at', '=', after.sortAt), eb('p.uri', '<', after.uri)]),
        ]),
      )
    }

    const rows = await query.execute()
    const last = rows.at(-1)
    return {
      feed: rows.map((row) => ({ post: row.uri })),
      // A short page is the end of the feed.
      ...(last !== undefined && rows.length === limit
        ? { cursor: encodeCursor(last.sort_at, last.uri) }
        : {}),
    }
  },
}

export const FEEDS: Record<string, Feed> = { recent }
