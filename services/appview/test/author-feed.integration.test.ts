import type { Database } from '@openreel/db'
import { ids, lexicons, type SocialOpenreelFeedGetAuthorFeed } from '@openreel/lexicons'
import { sql, type Kysely } from 'kysely'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createApp } from '../src/app.ts'
import type { JetstreamEvent } from '../src/indexer/events.ts'
import { Indexer, VIDEO_POST_COLLECTION } from '../src/indexer/indexer.ts'
import { freshDatabase, hasDb } from './db.ts'

const ALICE = 'did:plc:alice000000000000000000000'
const BOB = 'did:plc:bob00000000000000000000000'
const CID = 'bafyreie5737gdxlw5i64vzichcalba3z2v5n6icifvx5xytvske7mr3hpm'
/** Valid raw CIDs, one per uploaded blob. */
const BLOB = {
  a1: 'bafkreihvl7yw6zxugnqcm24v3nxy73ab25qdcbkda2xeuszyawmpnt6rcq',
  a2: 'bafkreibmhjbetv3qoacymso33arnzl3zk5mg7tscrt5szkelsr2b5wula4',
  a3: 'bafkreihunxjiuvez3dx66c4pxdxb5qofuxsapsjyc5a5k5v2rxvu6wpmh4',
  a4: 'bafkreicfhhsljceqphbkacx6vyf7yfbzqqhpen42d64bzc5conq22r3nnm',
  b1: 'bafkreid5zfxxo3eeepsxuj4fjcnd7hcd7nxhk2dw22wzvhfmjksoolwbsm',
}

let time = 1_000
function createPost(did: string, rkey: string, blob: string, createdAt: string): JetstreamEvent {
  return {
    kind: 'commit',
    did,
    time_us: time++,
    commit: {
      operation: 'create',
      collection: VIDEO_POST_COLLECTION,
      rkey,
      cid: CID,
      record: {
        $type: VIDEO_POST_COLLECTION,
        video: { $type: 'blob', ref: { $link: blob }, mimeType: 'video/mp4', size: 1000 },
        durationMs: 5000,
        createdAt,
      },
    },
  }
}

const uri = (did: string, rkey: string) => `at://${did}/${VIDEO_POST_COLLECTION}/${rkey}`

/**
 * getAuthorFeed against a real Postgres: one account's playable posts, newest
 * first, paged. Runs when TEST_DATABASE_URL is set (see ./db.ts).
 */
describe.skipIf(!hasDb)('getAuthorFeed against Postgres', () => {
  let db: Kysely<Database>
  let drop: () => Promise<void>
  let indexer: Indexer
  let app: ReturnType<typeof createApp>

  beforeAll(async () => {
    ;({ db, drop } = await freshDatabase('openreel_appview_author_feed_test'))
    indexer = new Indexer(db, {
      resolve: (did) => Promise.resolve({ did, handle: `${did.slice(8, 13)}.test` }),
    })
    app = createApp({
      db,
      skeleton: {
        getFeedSkeleton: () => Promise.resolve({ feed: [] }),
        describeFeeds: () => Promise.resolve([]),
      },
      defaultFeedUri: 'at://openreel.social/social.openreel.feed.generator/recent',
      mediaPublicUrl: 'https://media.test',
    })
  })

  afterAll(() => drop())

  beforeEach(async () => {
    await sql`truncate actor, video_post, video_media, video_post_stats cascade`.execute(db)
    await indexer.handle(createPost(ALICE, '3ka1', BLOB.a1, '2026-11-01T00:00:00Z'))
    await indexer.handle(createPost(ALICE, '3ka2', BLOB.a2, '2026-11-02T00:00:00Z'))
    await indexer.handle(createPost(ALICE, '3ka3', BLOB.a3, '2026-11-03T00:00:00Z'))
    await indexer.handle(createPost(BOB, '3kb1', BLOB.b1, '2026-11-04T00:00:00Z'))
    await db.updateTable('video_media').set({ status: 'ready' }).execute()
    // Still transcoding: not playable, so not listed.
    await indexer.handle(createPost(ALICE, '3ka4', BLOB.a4, '2026-11-05T00:00:00Z'))
  })

  async function authorFeed(query: Record<string, string>) {
    const res = await request(app).get('/xrpc/social.openreel.feed.getAuthorFeed').query(query)
    if (res.status === 200) {
      lexicons.assertValidXrpcOutput(ids.SocialOpenreelFeedGetAuthorFeed, res.body)
    }
    const body = res.body as SocialOpenreelFeedGetAuthorFeed.OutputSchema & { error?: string }
    return { status: res.status, body, uris: () => body.feed.map((post) => post.uri) }
  }

  it("lists only the account's playable posts, newest first", async () => {
    const page = await authorFeed({ actor: ALICE })
    expect(page.status).toBe(200)
    expect(page.uris()).toEqual([uri(ALICE, '3ka3'), uri(ALICE, '3ka2'), uri(ALICE, '3ka1')])
    expect(page.body.feed[0]).toMatchObject({
      author: { did: ALICE, handle: 'alice.test' },
      playlist: `https://media.test/${encodeURIComponent(ALICE)}/${BLOB.a3}/playlist.m3u8`,
    })
    expect(page.body.cursor).toBeUndefined()
  })

  it('pages with a cursor, every page but the last full', async () => {
    const first = await authorFeed({ actor: ALICE, limit: '2' })
    expect(first.uris()).toEqual([uri(ALICE, '3ka3'), uri(ALICE, '3ka2')])
    const second = await authorFeed({ actor: ALICE, limit: '2', cursor: first.body.cursor ?? '' })
    expect(second.uris()).toEqual([uri(ALICE, '3ka1')])
    expect(second.body.cursor).toBeUndefined()
    expect((await authorFeed({ actor: ALICE, cursor: 'nonsense' })).status).toBe(400)
  })

  it('accepts a handle, and answers NotFound for an unknown one', async () => {
    expect((await authorFeed({ actor: 'bob00.test' })).uris()).toEqual([uri(BOB, '3kb1')])
    const unknown = await authorFeed({ actor: 'nobody.test' })
    expect(unknown.status).toBe(404)
    expect(unknown.body.error).toBe('NotFound')
  })

  it('returns an empty feed for a DID with nothing indexed', async () => {
    const page = await authorFeed({ actor: 'did:plc:newcomer00000000000000000' })
    expect(page.status).toBe(200)
    expect(page.body.feed).toEqual([])
  })

  it('rejects a missing or malformed actor', async () => {
    expect((await authorFeed({})).status).toBe(400)
    expect((await authorFeed({ actor: 'not a handle' })).status).toBe(400)
  })
})
