import type { Database } from '@openreel/db'
import type { SocialOpenreelFeedGetFeed } from '@openreel/lexicons'
import type { Kysely } from 'kysely'
import { sql } from 'kysely'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { UPDATE_SUBJECT_STATUS } from '../src/admin.ts'
import { createApp } from '../src/app.ts'
import type { JetstreamEvent } from '../src/indexer/events.ts'
import { COMMENT_COLLECTION, Indexer, VIDEO_POST_COLLECTION } from '../src/indexer/indexer.ts'
import { freshDatabase, hasDb } from './db.ts'

const AUTHOR = 'did:plc:author0000000000000000000'
const VIEWER = 'did:plc:viewer0000000000000000000'
const CID = 'bafyreie5737gdxlw5i64vzichcalba3z2v5n6icifvx5xytvske7mr3hpm'
const SHARED_BLOB = 'bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku'
const OWN_BLOB = 'bafkreiabaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const PASSWORD = 'correct horse'

const postUri = (rkey: string) => `at://${AUTHOR}/${VIDEO_POST_COLLECTION}/${rkey}`
const POSTS = { a: postUri('3kposta'), b: postUri('3kpostb'), c: postUri('3kpostc') }

let time = 1_000
function createPost(rkey: string, blob: string): JetstreamEvent {
  return {
    kind: 'commit',
    did: AUTHOR,
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
        createdAt: '2026-11-01T00:00:00.000Z',
      },
    },
  }
}

function createComment(did: string, rkey: string, subject: string): JetstreamEvent {
  return {
    kind: 'commit',
    did,
    time_us: time++,
    commit: {
      operation: 'create',
      collection: COMMENT_COLLECTION,
      rkey,
      cid: CID,
      record: {
        $type: COMMENT_COLLECTION,
        subject: { uri: subject, cid: CID },
        text: 'nice',
        createdAt: '2026-11-02T00:00:00.000Z',
      },
    },
  }
}

/**
 * Takedowns (#120) through the AppView's com.atproto.admin.updateSubjectStatus,
 * against a real Postgres: what getFeed and getComments stop serving, which
 * renditions are queued for removal, and that replays cannot bring a
 * taken-down subject back. Runs when TEST_DATABASE_URL is set (see ./db.ts).
 */
describe.skipIf(!hasDb)('takedowns against Postgres', () => {
  let db: Kysely<Database>
  let drop: () => Promise<void>
  let indexer: Indexer
  let app: ReturnType<typeof createApp>

  beforeAll(async () => {
    ;({ db, drop } = await freshDatabase('openreel_appview_moderation_test'))
    indexer = new Indexer(db, { resolve: (did) => Promise.resolve({ did }) })
    app = createApp({
      db,
      skeleton: {
        getFeedSkeleton: () =>
          Promise.resolve({ feed: Object.values(POSTS).map((post) => ({ post })) }),
        describeFeeds: () => Promise.resolve([]),
      },
      defaultFeedUri: 'at://openreel.social/social.openreel.feed.generator/recent',
      mediaPublicUrl: 'https://media.test',
      takedowns: indexer,
      adminPassword: PASSWORD,
    })
  })

  afterAll(() => drop())

  beforeEach(async () => {
    await sql`truncate actor, video_post, video_media, video_comment, video_post_stats, moderation_takedown cascade`.execute(
      db,
    )
    // Posts a and b share one upload; c has its own.
    await indexer.handle(createPost('3kposta', SHARED_BLOB))
    await indexer.handle(createPost('3kpostb', SHARED_BLOB))
    await indexer.handle(createPost('3kpostc', OWN_BLOB))
    await db.updateTable('video_media').set({ status: 'ready' }).execute()
    await indexer.handle(createComment(VIEWER, '3kc1', POSTS.c))
    await indexer.handle(createComment(VIEWER, '3kc2', POSTS.a))
  })

  const takedown = (subject: Record<string, string>, applied = true, password = PASSWORD) =>
    request(app)
      .post(`/xrpc/${UPDATE_SUBJECT_STATUS}`)
      .auth('admin', password)
      .send({ subject, takedown: { applied, ref: 'test' } })

  const feed = async () =>
    (
      (await request(app).get('/xrpc/social.openreel.feed.getFeed'))
        .body as SocialOpenreelFeedGetFeed.OutputSchema
    ).feed.map((post) => post.uri)

  const mediaStatus = async (cid: string) =>
    (
      await db
        .selectFrom('video_media')
        .select('status')
        .where('video_cid', '=', cid)
        .executeTakeFirst()
    )?.status

  it('requires the admin password', async () => {
    expect((await takedown({ uri: POSTS.c, cid: CID }, true, 'wrong')).status).toBe(401)
    expect((await request(app).post(`/xrpc/${UPDATE_SUBJECT_STATUS}`).send({})).status).toBe(401)
    const noAdmin = createApp({
      db,
      skeleton: {
        getFeedSkeleton: () => Promise.resolve({ feed: [] }),
        describeFeeds: () => Promise.resolve([]),
      },
      defaultFeedUri: 'at://x/y/z',
      mediaPublicUrl: 'https://media.test',
      takedowns: indexer,
    })
    expect(
      (await request(noAdmin).post(`/xrpc/${UPDATE_SUBJECT_STATUS}`).auth('admin', '').send({}))
        .status,
    ).toBe(501)
    expect((await takedown({ nonsense: 'x' })).status).toBe(400)
    expect(await feed()).toHaveLength(3)
  })

  it('a taken-down post leaves the feed, its comments go, and its renditions are queued for removal', async () => {
    const res = await takedown({ uri: POSTS.c, cid: CID })
    expect(res.status).toBe(200)

    expect(await feed()).toEqual([POSTS.a, POSTS.b])
    expect(
      (await request(app).get('/xrpc/social.openreel.video.getComments').query({ uri: POSTS.c }))
        .status,
    ).toBe(404)
    expect(await mediaStatus(OWN_BLOB)).toBe('removing')

    // A replay of its create event does not bring it back.
    await indexer.handle(createPost('3kpostc', OWN_BLOB))
    expect(await feed()).toEqual([POSTS.a, POSTS.b])
    expect(await mediaStatus(OWN_BLOB)).toBe('removing')
  })

  it('renditions shared with a post that stays are kept', async () => {
    await takedown({ uri: POSTS.a, cid: CID })
    expect(await feed()).toEqual([POSTS.b, POSTS.c])
    expect(await mediaStatus(SHARED_BLOB)).toBe('ready')

    // The last post using them goes (here, deleted by its author).
    await indexer.handle({
      kind: 'commit',
      did: AUTHOR,
      time_us: time++,
      commit: { operation: 'delete', collection: VIDEO_POST_COLLECTION, rkey: '3kpostb' },
    })
    expect(await mediaStatus(SHARED_BLOB)).toBe('removing')
  })

  it("a taken-down account loses its posts, comments, and renditions, and isn't indexed again", async () => {
    await takedown({ did: VIEWER })
    expect(await db.selectFrom('video_comment').select('uri').execute()).toEqual([])
    await indexer.handle(createComment(VIEWER, '3kc3', POSTS.a))
    expect(await db.selectFrom('video_comment').select('uri').execute()).toEqual([])

    await takedown({ did: AUTHOR })
    expect(await feed()).toEqual([])
    expect(await mediaStatus(SHARED_BLOB)).toBe('removing')
    expect(await mediaStatus(OWN_BLOB)).toBe('removing')
  })

  it('taking down a comment removes only it', async () => {
    await takedown({ uri: `at://${VIEWER}/${COMMENT_COLLECTION}/3kc1`, cid: CID })
    const left = await db.selectFrom('video_comment').select('uri').execute()
    expect(left.map((row) => row.uri)).toEqual([`at://${VIEWER}/${COMMENT_COLLECTION}/3kc2`])
  })

  it('lifting a takedown lets the record be indexed again, and re-queues its transcode', async () => {
    await takedown({ uri: POSTS.c, cid: CID })
    expect((await takedown({ uri: POSTS.c, cid: CID }, false)).status).toBe(200)

    await indexer.handle(createPost('3kpostc', OWN_BLOB))
    expect(await mediaStatus(OWN_BLOB)).toBe('pending')
  })
})
