import { purpose, type Database } from '@openreel/db'
import type { SocialOpenreelVideoDefs } from '@openreel/lexicons'
import type { Kysely } from 'kysely'

import { decodeCursor, encodeCursor } from './cursor.ts'
import { hydratePosts } from './hydrate.ts'

export interface AuthorFeedQuery {
  /** DID or handle. */
  actor: string
  limit: number
  cursor?: string
}

export interface AuthorFeedPage {
  feed: SocialOpenreelVideoDefs.PostView[]
  cursor?: string
}

/** A handle the AppView has not seen, so it cannot be turned into a DID. */
export class UnknownActorError extends Error {}

/**
 * One page of an account's playable video posts, newest first by the same
 * `sort_at` the chronological feed uses. Paging happens before hydration, over
 * posts whose media is ready, so every page but the last is full. A DID with
 * nothing indexed (new, or taken down) is an empty feed, not an error.
 */
export async function getAuthorFeed(
  db: Kysely<Database>,
  params: AuthorFeedQuery,
  mediaPublicUrl: string,
): Promise<AuthorFeedPage> {
  const after = params.cursor === undefined ? undefined : decodeCursor(params.cursor)
  const did = params.actor.startsWith('did:') ? params.actor : await resolveHandle(db, params.actor)

  let query = db
    .selectFrom('video_post as p')
    .innerJoin('video_media as m', (join) =>
      join.onRef('m.author_did', '=', 'p.author_did').onRef('m.video_cid', '=', 'p.video_cid'),
    )
    .select(['p.uri', 'p.sort_at'])
    .where('p.author_did', '=', did)
    .where('m.status', '=', 'ready')
    .orderBy('p.sort_at', 'desc')
    .orderBy('p.uri', 'desc')
    .limit(params.limit)
  if (after !== undefined) {
    query = query.where((eb) =>
      eb.or([
        eb('p.sort_at', '<', after.sortAt),
        eb.and([eb('p.sort_at', '=', after.sortAt), eb('p.uri', '<', after.uri)]),
      ]),
    )
  }

  const rows = await purpose("Select an author's playable posts, newest first", () =>
    query.execute(),
  )
  const feed = await hydratePosts(
    db,
    rows.map((row) => row.uri),
    mediaPublicUrl,
  )
  const last = rows.at(-1)
  return {
    feed,
    // A short page is the end.
    ...(last !== undefined && rows.length === params.limit
      ? { cursor: encodeCursor(last.sort_at, last.uri) }
      : {}),
  }
}

async function resolveHandle(db: Kysely<Database>, handle: string): Promise<string> {
  const row = await purpose('Look up actor by handle', () =>
    db
      .selectFrom('actor')
      .select('did')
      .where('handle', '=', handle.toLowerCase())
      .executeTakeFirst(),
  )
  if (row === undefined) throw new UnknownActorError(`unknown handle ${handle}`)
  return row.did
}
