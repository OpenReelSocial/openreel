import { createDb, migrateToLatest, resetDatabase, type Database } from '@openreel/db'
import type { Kysely } from 'kysely'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createApp } from '../src/app.ts'
import type { CommitEvent } from '../src/indexer/events.ts'
import { Indexer } from '../src/indexer/indexer.ts'
import { deps, did, postRecordJson, postUri, recordCid, videoCid } from './fixtures.ts'

/**
 * Indexer and hydration against a real Postgres. Runs when TEST_DATABASE_URL
 * is set (see packages/db/test/integration.test.ts); it drops every table.
 */
const url = process.env['TEST_DATABASE_URL']

function commit(
  rkey: string,
  operation: CommitEvent['commit']['operation'],
  record?: Record<string, unknown>,
): CommitEvent {
  return {
    did,
    time_us: Date.now() * 1000,
    kind: 'commit',
    commit: {
      operation,
      collection: 'social.openreel.video.post',
      rkey,
      ...(record === undefined ? {} : { record, cid: recordCid }),
    },
  }
}

describe.skipIf(url === undefined)('indexer and getFeed against Postgres', () => {
  let db: Kysely<Database>
  let resolutions = 0
  const indexer = (): Indexer =>
    new Indexer(db, {
      resolve: (d) => {
        resolutions += 1
        return Promise.resolve({ did: d, handle: 'alice.openreel.test' })
      },
    })

  beforeAll(async () => {
    db = createDb(url ?? '')
    await resetDatabase(db)
    await migrateToLatest(db)
  })

  beforeEach(async () => {
    await db.deleteFrom('video_post').execute()
    await db.deleteFrom('video_media').execute()
    await db.deleteFrom('actor').execute()
    resolutions = 0
  })

  afterAll(async () => {
    await db.destroy()
  })

  it('indexes a post, its author, and queues its blob for transcoding', async () => {
    await indexer().handle(commit('3aaa', 'create', postRecordJson()))

    const post = await db.selectFrom('video_post').selectAll().executeTakeFirstOrThrow()
    expect(post).toMatchObject({
      uri: postUri('3aaa'),
      cid: recordCid,
      author_did: did,
      video_cid: videoCid,
      duration_ms: 5_000,
      record: postRecordJson(),
    })
    // createdAt is in the past, so it is also the feed position.
    expect(post.sort_at.toISOString()).toBe('2026-10-01T12:00:00.000Z')

    const actor = await db.selectFrom('actor').selectAll().executeTakeFirstOrThrow()
    expect(actor.handle).toBe('alice.openreel.test')

    const media = await db.selectFrom('video_media').selectAll().executeTakeFirstOrThrow()
    expect(media).toMatchObject({ author_did: did, video_cid: videoCid, status: 'pending' })
  })

  it('clamps a future createdAt to the time it was indexed', async () => {
    await indexer().handle(
      commit('3aab', 'create', postRecordJson({ createdAt: '2099-01-01T00:00:00Z' })),
    )

    const post = await db.selectFrom('video_post').selectAll().executeTakeFirstOrThrow()
    expect(post.sort_at.getTime()).toBeLessThanOrEqual(Date.now())
  })

  it('is idempotent on replay and resolves each author once', async () => {
    const event = commit('3aac', 'create', postRecordJson())
    const i = indexer()
    await i.handle(event)
    await i.handle(event)

    expect(await db.selectFrom('video_post').select('uri').execute()).toHaveLength(1)
    expect(await db.selectFrom('video_media').select('video_cid').execute()).toHaveLength(1)
    expect(resolutions).toBe(1)
  })

  it('applies edits without moving the post or re-queuing the blob', async () => {
    const i = indexer()
    await i.handle(commit('3aad', 'create', postRecordJson()))
    await db.updateTable('video_media').set({ status: 'ready' }).execute()
    await i.handle(
      commit(
        '3aad',
        'update',
        postRecordJson({ caption: 'edited', createdAt: '2026-10-02T00:00:00Z' }),
      ),
    )

    const post = await db.selectFrom('video_post').selectAll().executeTakeFirstOrThrow()
    expect(post.caption).toBe('edited')
    expect(post.sort_at.toISOString()).toBe('2026-10-01T12:00:00.000Z')
    const media = await db.selectFrom('video_media').selectAll().executeTakeFirstOrThrow()
    expect(media.status).toBe('ready')
  })

  it('removes deleted posts and the posts of deleted accounts', async () => {
    const i = indexer()
    await i.handle(commit('3aae', 'create', postRecordJson()))
    await i.handle(commit('3aaf', 'create', postRecordJson()))
    await i.handle(commit('3aae', 'delete'))
    expect((await db.selectFrom('video_post').select('uri').execute()).map((r) => r.uri)).toEqual([
      postUri('3aaf'),
    ])

    await i.handle({
      did,
      time_us: 1,
      kind: 'account',
      account: { did, active: false, status: 'deleted' },
    })
    expect(await db.selectFrom('video_post').select('uri').execute()).toEqual([])
  })

  it('ignores records that fail Lexicon validation', async () => {
    await indexer().handle(commit('3aag', 'create', postRecordJson({ durationMs: -1 })))
    expect(await db.selectFrom('video_post').select('uri').execute()).toEqual([])
  })

  it('updates handles from identity events', async () => {
    await indexer().handle({
      did,
      time_us: 1,
      kind: 'identity',
      identity: { did, handle: 'renamed.openreel.test' },
    })
    const actor = await db.selectFrom('actor').selectAll().executeTakeFirstOrThrow()
    expect(actor.handle).toBe('renamed.openreel.test')
  })

  it('hydrates the skeleton in order, skipping posts without ready media', async () => {
    const i = indexer()
    const otherCid = 'bafkreidgvpkjawlxz6sffxzwgooowe5yt7i6wsyg236mfoks77nywkptdq'
    await i.handle(commit('3ab1', 'create', postRecordJson()))
    await i.handle(
      commit(
        '3ab2',
        'create',
        postRecordJson({
          video: { $type: 'blob', ref: { $link: otherCid }, mimeType: 'video/mp4', size: 1 },
        }),
      ),
    )
    // Only the first blob has finished transcoding.
    await db
      .updateTable('video_media')
      .set({ status: 'ready', width: 720, height: 1280, duration_ms: 4_960 })
      .where('video_cid', '=', videoCid)
      .execute()

    const skeleton = {
      getFeedSkeleton: () =>
        Promise.resolve({
          feed: [
            { post: postUri('3ab2') },
            { post: postUri('missing') },
            { post: postUri('3ab1') },
          ],
          cursor: 'c2',
        }),
    }
    const res = await request(createApp(deps(skeleton, db))).get(
      '/xrpc/social.openreel.feed.getFeed',
    )

    expect(res.status).toBe(200)
    const body = res.body as { cursor?: string; feed: Record<string, unknown>[] }
    expect(body.cursor).toBe('c2')
    expect(body.feed).toMatchObject([
      {
        uri: postUri('3ab1'),
        cid: recordCid,
        author: { did, handle: 'alice.openreel.test' },
        record: postRecordJson(),
        playlist: `https://media.test/${encodeURIComponent(did)}/${videoCid}/playlist.m3u8`,
        thumbnail: `https://media.test/${encodeURIComponent(did)}/${videoCid}/poster.jpg`,
        aspectRatio: { width: 9, height: 16 },
        durationMs: 4_960,
      },
    ])
    expect(Object.keys(body.feed[0] ?? {})).toContain('indexedAt')
  })
})
