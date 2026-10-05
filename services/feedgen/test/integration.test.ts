import { createDb, migrateToLatest, resetDatabase, type Database } from '@openreel/db'
import type { Kysely } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { recent } from '../src/feeds.ts'

/**
 * The chronological feed against a real Postgres. Runs when TEST_DATABASE_URL
 * is set (see packages/db/test/integration.test.ts); it drops every table.
 */
const url = process.env['TEST_DATABASE_URL']
const did = 'did:plc:ri7muaelw3trwgd2eda7tuf2'

describe.skipIf(url === undefined)('recent feed against Postgres', () => {
  let db: Kysely<Database>

  beforeAll(async () => {
    db = createDb(url ?? '')
    await resetDatabase(db)
    await migrateToLatest(db)
    await db.insertInto('actor').values({ did, handle: null }).execute()

    // Five posts; two share a timestamp; one has media still transcoding.
    const posts: [rkey: string, sortAt: string, status: 'ready' | 'pending'][] = [
      ['a', '2026-10-01T10:00:00Z', 'ready'],
      ['b', '2026-10-01T11:00:00Z', 'ready'],
      ['c', '2026-10-01T11:00:00Z', 'ready'],
      ['d', '2026-10-01T12:00:00Z', 'pending'],
      ['e', '2026-10-01T13:00:00Z', 'ready'],
    ]
    for (const [rkey, sortAt, status] of posts) {
      await db
        .insertInto('video_post')
        .values({
          uri: `at://${did}/social.openreel.video.post/${rkey}`,
          cid: `bafyrecord${rkey}`,
          author_did: did,
          video_cid: `bafkvideo${rkey}`,
          created_at: sortAt,
          sort_at: sortAt,
        })
        .execute()
      await db
        .insertInto('video_media')
        .values({ author_did: did, video_cid: `bafkvideo${rkey}`, status })
        .execute()
    }
  })

  afterAll(async () => {
    await db.destroy()
  })

  it('pages newest first, skipping unplayable posts, without gaps or repeats', async () => {
    const seen: string[] = []
    let cursor: string | undefined
    for (let i = 0; i < 5; i++) {
      const page = await recent.page(db, 2, cursor)
      seen.push(...page.feed.map((item) => item.post.split('/').at(-1) ?? ''))
      cursor = page.cursor
      if (cursor === undefined) break
    }

    expect(seen).toEqual(['e', 'c', 'b', 'a'])
    expect(cursor).toBeUndefined()
  })
})
