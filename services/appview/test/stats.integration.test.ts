import type { Database } from '@openreel/db'
import type { Kysely } from 'kysely'
import { sql } from 'kysely'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { JetstreamEvent } from '../src/indexer/events.ts'
import {
  Indexer,
  LIKE_COLLECTION,
  VIDEO_POST_COLLECTION,
  WATCH_EVENT_COLLECTION,
} from '../src/indexer/indexer.ts'
import { freshDatabase, hasDb } from './db.ts'

const AUTHOR = 'did:plc:author0000000000000000000'
const CID = 'bafyreie5737gdxlw5i64vzichcalba3z2v5n6icifvx5xytvske7mr3hpm'
const BLOB = 'bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku'
const POST = `at://${AUTHOR}/${VIDEO_POST_COLLECTION}/3kpost`

const viewer = (name: string) => `did:plc:${name.padEnd(24, '0')}`

let time = 1_000
let rkey = 0
function create(did: string, collection: string, record: Record<string, unknown>): JetstreamEvent {
  rkey += 1
  return {
    kind: 'commit',
    did,
    time_us: time++,
    commit: {
      operation: 'create',
      collection,
      rkey: collection === VIDEO_POST_COLLECTION ? '3kpost' : `3k${rkey}`,
      cid: CID,
      record: { $type: collection, createdAt: '2026-11-02T00:00:00.000Z', ...record },
    },
  }
}

const watch = (did: string, watchDurationMs: number) =>
  create(did, WATCH_EVENT_COLLECTION, {
    subject: { uri: POST, cid: CID },
    watchDurationMs,
    videoDurationMs: 5000,
  })

const like = (did: string) => create(did, LIKE_COLLECTION, { subject: { uri: POST, cid: CID } })

/**
 * The per-post counts the AppView keeps for feedgen's signals, indexed from
 * real events against a real Postgres. Runs when TEST_DATABASE_URL is set
 * (see ./db.ts).
 */
describe.skipIf(!hasDb)('post stats against Postgres', () => {
  let db: Kysely<Database>
  let drop: () => Promise<void>
  let indexer: Indexer

  beforeAll(async () => {
    ;({ db, drop } = await freshDatabase('openreel_appview_stats_test'))
    indexer = new Indexer(db, { resolve: (did) => Promise.resolve({ did }) })
  })

  afterAll(() => drop())

  beforeEach(async () => {
    await sql`truncate actor, video_post, video_media, watch_event, video_like, video_post_stats cascade`.execute(
      db,
    )
    await indexer.handle(
      create(AUTHOR, VIDEO_POST_COLLECTION, {
        video: { $type: 'blob', ref: { $link: BLOB }, mimeType: 'video/mp4', size: 1000 },
        durationMs: 5000,
      }),
    )
  })

  const stats = () =>
    db
      .selectFrom('video_post_stats')
      .select(['view_count', 'like_count', 'viewer_count', 'viewer_like_count'])
      .where('uri', '=', POST)
      .executeTakeFirstOrThrow()

  it('gives a post with no events zeros', async () => {
    expect(await stats()).toEqual({
      view_count: 0,
      like_count: 0,
      viewer_count: 0,
      viewer_like_count: 0,
    })
  })

  it('counts a rewatch as one viewer but two views', async () => {
    await indexer.handle(watch(viewer('rewatcher'), 5000))
    await indexer.handle(watch(viewer('rewatcher'), 2500))

    expect(await stats()).toMatchObject({ view_count: 2, viewer_count: 1 })
  })

  it('counts only likes from accounts that shared a watch toward the ratio', async () => {
    await indexer.handle(watch(viewer('sharer'), 4500))
    await indexer.handle(like(viewer('sharer')))
    await indexer.handle(like(viewer('sharer'))) // a second like from one account counts once
    await indexer.handle(like(viewer('lurker'))) // liked without publishing a watch event
    await indexer.handle(watch(viewer('watcher'), 2000))

    expect(await stats()).toEqual({
      view_count: 2,
      like_count: 2,
      viewer_count: 2,
      viewer_like_count: 1,
    })
  })

  it('recounts the ratio when a liker publishes a watch after liking', async () => {
    await indexer.handle(like(viewer('early')))
    expect(await stats()).toMatchObject({ viewer_count: 0, viewer_like_count: 0 })

    await indexer.handle(watch(viewer('early'), 5000))
    expect(await stats()).toMatchObject({ viewer_count: 1, viewer_like_count: 1 })
  })
})
