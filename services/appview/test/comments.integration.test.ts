import { closeDb, createDb, migrateToLatest, type Database } from '@openreel/db'
import {
  ids,
  lexicons,
  type SocialOpenreelFeedGetFeed,
  type SocialOpenreelVideoComment,
  type SocialOpenreelVideoGetComments,
} from '@openreel/lexicons'
import { sql, type Kysely } from 'kysely'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createApp } from '../src/app.ts'
import type { JetstreamEvent } from '../src/indexer/events.ts'
import { COMMENT_COLLECTION, Indexer, VIDEO_POST_COLLECTION } from '../src/indexer/indexer.ts'

/**
 * Indexes comments from Jetstream-shaped events into a real Postgres and reads
 * them back through getComments and getFeed's post views. Runs when
 * TEST_DATABASE_URL is set (see packages/db/test/integration.test.ts). It works
 * in its own database beside that one, which it recreates, so it does not race
 * the db package's suite when turbo runs both at once.
 */
const url = process.env['TEST_DATABASE_URL']
const hasDb = url !== undefined && url !== ''

const AUTHOR = 'did:plc:author0000000000000000000'
const VIEWER = 'did:plc:viewer0000000000000000000'
const OTHER = 'did:plc:other00000000000000000000'
const CID = 'bafyreie5737gdxlw5i64vzichcalba3z2v5n6icifvx5xytvske7mr3hpm'
const VIDEO_CID = 'bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku'
const POST = `at://${AUTHOR}/${VIDEO_POST_COLLECTION}/3kpost0000001`

let time = 1_000
function commit(
  did: string,
  collection: string,
  rkey: string,
  record?: Record<string, unknown>,
): JetstreamEvent {
  return {
    kind: 'commit',
    did,
    time_us: time++,
    commit: {
      operation: record === undefined ? 'delete' : 'create',
      collection,
      rkey,
      ...(record === undefined ? {} : { record, cid: CID }),
    },
  }
}

function postRecord(): Record<string, unknown> {
  return {
    $type: VIDEO_POST_COLLECTION,
    video: { $type: 'blob', ref: { $link: VIDEO_CID }, mimeType: 'video/mp4', size: 1000 },
    durationMs: 5000,
    createdAt: '2026-11-01T00:00:00.000Z',
  }
}

function commentRecord(text: string, createdAt: string, parent?: string): Record<string, unknown> {
  return {
    $type: COMMENT_COLLECTION,
    subject: { uri: POST, cid: CID },
    ...(parent === undefined ? {} : { parent: { uri: parent, cid: CID } }),
    text,
    createdAt,
  }
}

function commentUri(did: string, rkey: string): string {
  return `at://${did}/${COMMENT_COLLECTION}/${rkey}`
}

describe.skipIf(!hasDb)('comments against Postgres', () => {
  let admin: Kysely<Database>
  let db: Kysely<Database>
  let indexer: Indexer
  let app: ReturnType<typeof createApp>

  beforeAll(async () => {
    admin = createDb(url ?? '')
    await sql`drop database if exists openreel_appview_test`.execute(admin)
    await sql`create database openreel_appview_test`.execute(admin)
    const own = new URL(url ?? '')
    own.pathname = '/openreel_appview_test'
    db = createDb(own.toString())
    await migrateToLatest(db)
    indexer = new Indexer(db, {
      resolve: (did) => Promise.resolve({ did, handle: `${did.slice(8, 14)}.test` } as never),
    })
    app = createApp({
      db,
      skeleton: {
        getFeedSkeleton: () => Promise.resolve({ feed: [{ post: POST }] }),
        describeFeeds: () => Promise.resolve([]),
      },
      defaultFeedUri: 'at://openreel.social/social.openreel.feed.generator/recent',
      mediaPublicUrl: 'https://media.test',
    })
  })

  afterAll(async () => {
    await closeDb(db)
    await sql`drop database if exists openreel_appview_test`.execute(admin)
    await closeDb(admin)
  })

  beforeEach(async () => {
    await sql`truncate actor, video_post, video_media, video_comment, video_post_stats cascade`.execute(
      db,
    )
    await indexer.handle(commit(AUTHOR, VIDEO_POST_COLLECTION, '3kpost0000001', postRecord()))
    await db
      .updateTable('video_media')
      .set({ status: 'ready', width: 1080, height: 1920, duration_ms: 5000 })
      .execute()
  })

  /** Calls getComments; a 200 must match the Lexicon's output schema. */
  async function comments(query: Record<string, string>) {
    const res = await request(app).get('/xrpc/social.openreel.video.getComments').query(query)
    if (res.status === 200) {
      lexicons.assertValidXrpcOutput(ids.SocialOpenreelVideoGetComments, res.body)
    }
    const body = res.body as SocialOpenreelVideoGetComments.OutputSchema & { error?: string }
    return { status: res.status, body, texts: () => body.comments.map(text) }
  }

  function text(comment: { record: unknown }): string {
    return (comment.record as SocialOpenreelVideoComment.Record).text
  }

  async function commentCount() {
    const res = await request(app).get('/xrpc/social.openreel.feed.getFeed')
    return (res.body as SocialOpenreelFeedGetFeed.OutputSchema).feed[0]?.commentCount
  }

  it('serves top-level comments newest first with reply counts, and replies oldest first', async () => {
    const top1 = commentUri(VIEWER, '3kc1')
    const top2 = commentUri(OTHER, '3kc2')
    await indexer.handle(
      commit(VIEWER, COMMENT_COLLECTION, '3kc1', commentRecord('first', '2026-11-02T00:00:00Z')),
    )
    await indexer.handle(
      commit(OTHER, COMMENT_COLLECTION, '3kc2', commentRecord('second', '2026-11-03T00:00:00Z')),
    )
    await indexer.handle(
      commit(
        OTHER,
        COMMENT_COLLECTION,
        '3kr1',
        commentRecord('reply a', '2026-11-04T00:00:00Z', top1),
      ),
    )
    await indexer.handle(
      commit(
        AUTHOR,
        COMMENT_COLLECTION,
        '3kr2',
        commentRecord('reply b', '2026-11-05T00:00:00Z', top1),
      ),
    )

    const top = await comments({ uri: POST })
    expect(top.status).toBe(200)
    expect(top.body.comments.map((c) => c.uri)).toEqual([top2, top1])
    expect(top.body.comments[1]).toMatchObject({
      author: { did: VIEWER, handle: 'viewer.test' },
      record: { text: 'first' },
      replyCount: 2,
    })

    const replies = await comments({ uri: POST, parent: top1 })
    expect(replies.texts()).toEqual(['reply a', 'reply b'])
    expect(replies.body.comments[0]?.replyCount).toBeUndefined()
    expect(await commentCount()).toBe(4)
  })

  it('pages with a cursor', async () => {
    for (const n of [1, 2, 3]) {
      await indexer.handle(
        commit(
          VIEWER,
          COMMENT_COLLECTION,
          `3kc${n}`,
          commentRecord(`c${n}`, `2026-11-0${n + 1}T00:00:00Z`),
        ),
      )
    }
    const first = await comments({ uri: POST, limit: '2' })
    expect(first.texts()).toEqual(['c3', 'c2'])
    const second = await comments({ uri: POST, limit: '2', cursor: first.body.cursor ?? '' })
    expect(second.texts()).toEqual(['c1'])
    expect(second.body.cursor).toBeUndefined()
    expect((await comments({ uri: POST, cursor: 'nonsense' })).status).toBe(400)
  })

  it('drops comments whose video or parent is not an indexed top-level comment', async () => {
    const top = commentUri(VIEWER, '3kc1')
    await indexer.handle(
      commit(VIEWER, COMMENT_COLLECTION, '3kc1', commentRecord('top', '2026-11-02T00:00:00Z')),
    )
    await indexer.handle(
      commit(
        OTHER,
        COMMENT_COLLECTION,
        '3kr1',
        commentRecord('reply', '2026-11-03T00:00:00Z', top),
      ),
    )
    // A reply to a reply, a reply to an unknown comment, and a comment on an unknown video.
    await indexer.handle(
      commit(
        OTHER,
        COMMENT_COLLECTION,
        '3kr2',
        commentRecord('nested', '2026-11-04T00:00:00Z', commentUri(OTHER, '3kr1')),
      ),
    )
    await indexer.handle(
      commit(
        OTHER,
        COMMENT_COLLECTION,
        '3kr3',
        commentRecord('orphan', '2026-11-04T00:00:00Z', commentUri(OTHER, 'nope')),
      ),
    )
    await indexer.handle(
      commit(OTHER, COMMENT_COLLECTION, '3kc9', {
        ...commentRecord('elsewhere', '2026-11-04T00:00:00Z'),
        subject: { uri: `at://${AUTHOR}/${VIDEO_POST_COLLECTION}/unknown`, cid: CID },
      }),
    )
    // Not a valid record: empty text.
    await indexer.handle(
      commit(OTHER, COMMENT_COLLECTION, '3kc8', commentRecord('', '2026-11-04T00:00:00Z')),
    )

    const rows = await db.selectFrom('video_comment').select('text').orderBy('text').execute()
    expect(rows.map((row) => row.text)).toEqual(['reply', 'top'])
    expect(await commentCount()).toBe(2)
  })

  it('deleting a comment removes its replies and recounts', async () => {
    const top = commentUri(VIEWER, '3kc1')
    await indexer.handle(
      commit(VIEWER, COMMENT_COLLECTION, '3kc1', commentRecord('top', '2026-11-02T00:00:00Z')),
    )
    await indexer.handle(
      commit(
        OTHER,
        COMMENT_COLLECTION,
        '3kr1',
        commentRecord('reply', '2026-11-03T00:00:00Z', top),
      ),
    )
    await indexer.handle(commit(VIEWER, COMMENT_COLLECTION, '3kc1'))

    expect((await comments({ uri: POST })).body.comments).toEqual([])
    expect((await comments({ uri: POST, parent: top })).status).toBe(404)
    expect(await commentCount()).toBe(0)
  })

  it('removed accounts take their comments with them, and a removed video answers NotFound', async () => {
    await indexer.handle(
      commit(VIEWER, COMMENT_COLLECTION, '3kc1', commentRecord('mine', '2026-11-02T00:00:00Z')),
    )
    await indexer.handle(
      commit(OTHER, COMMENT_COLLECTION, '3kc2', commentRecord('theirs', '2026-11-03T00:00:00Z')),
    )
    await indexer.handle({
      kind: 'account',
      did: VIEWER,
      time_us: time++,
      account: { did: VIEWER, active: false, status: 'takendown' },
    })
    expect((await comments({ uri: POST })).texts()).toEqual(['theirs'])
    expect(await commentCount()).toBe(1)

    await indexer.handle(commit(AUTHOR, VIDEO_POST_COLLECTION, '3kpost0000001'))
    const gone = await comments({ uri: POST })
    expect(gone.status).toBe(404)
    expect(gone.body.error).toBe('NotFound')
    expect(await db.selectFrom('video_comment').select('uri').execute()).toEqual([])
  })
})
