import { mkdtemp, readdir, readFile } from 'node:fs/promises'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createDb, migrateToLatest, resetDatabase, type Database } from '@openreel/db'
import { sql, type Kysely } from 'kysely'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { BlobFetcher } from '../src/blob.ts'
import { claimJob } from '../src/jobs.ts'
import { FileMediaStore } from '../src/store.ts'
import { transcode } from '../src/transcode.ts'
import { Worker } from '../src/worker.ts'
import { blobCid, fakePds, hasFfmpeg, makeClip } from './helpers.ts'

/**
 * The job queue and the whole worker against a real Postgres. Runs when
 * TEST_DATABASE_URL is set (see packages/db/test/integration.test.ts); it
 * drops every table.
 */
const url = process.env['TEST_DATABASE_URL']
const did = 'did:plc:ri7muaelw3trwgd2eda7tuf2'

describe.skipIf(url === undefined)('media queue against Postgres', () => {
  let db: Kysely<Database>

  async function addPost(videoCid: string, createdAt = '2026-10-01T00:00:00Z'): Promise<void> {
    await db
      .insertInto('video_post')
      .values({
        uri: `at://${did}/social.openreel.video.post/${videoCid}`,
        cid: 'bafyrecord',
        author_did: did,
        video_cid: videoCid,
        created_at: createdAt,
      })
      .execute()
    await db
      .insertInto('video_media')
      .values({ author_did: did, video_cid: videoCid, created_at: createdAt })
      .onConflict((oc) => oc.columns(['author_did', 'video_cid']).doNothing())
      .execute()
  }

  beforeAll(async () => {
    db = createDb(url ?? '')
    await resetDatabase(db)
    await migrateToLatest(db)
    await db.insertInto('actor').values({ did, handle: null }).execute()
  })

  beforeEach(async () => {
    await db.deleteFrom('video_post').execute()
    await db.deleteFrom('video_media').execute()
  })

  afterAll(async () => {
    await db.destroy()
  })

  it('claims the oldest pending job once', async () => {
    await addPost('bafknewer', '2026-10-02T00:00:00Z')
    await addPost('bafkolder', '2026-10-01T00:00:00Z')

    const [a, b, c] = await Promise.all([claimJob(db, 3), claimJob(db, 3), claimJob(db, 3)])
    const claimed = [a, b, c].filter((j) => j !== undefined).map((j) => j.videoCid)

    expect(claimed.sort()).toEqual(['bafknewer', 'bafkolder'])
    expect(a?.videoCid).toBe('bafkolder')
    expect(a?.attempts).toBe(1)
  })

  it('skips blobs no post references', async () => {
    await addPost('bafkorphan')
    await db.deleteFrom('video_post').execute()

    expect(await claimJob(db, 3)).toBeUndefined()
  })

  it('retries failures after a backoff, up to the attempt limit', async () => {
    await addPost('bafkflaky')
    await db.updateTable('video_media').set({ status: 'failed', attempts: 1 }).execute()
    expect(await claimJob(db, 3)).toBeUndefined()

    await db
      .updateTable('video_media')
      .set({ status: 'failed', updated_at: sql<Date>`now() - interval '2 minutes'` })
      .execute()
    expect((await claimJob(db, 3))?.attempts).toBe(2)

    await db
      .updateTable('video_media')
      .set({ status: 'failed', attempts: 3, updated_at: sql<Date>`now() - interval '1 hour'` })
      .execute()
    expect(await claimJob(db, 3)).toBeUndefined()
  })

  it('reclaims jobs whose worker went quiet', async () => {
    await addPost('bafkstale')
    await db
      .updateTable('video_media')
      .set({
        status: 'processing',
        attempts: 1,
        claimed_at: sql<Date>`now() - interval '20 minutes'`,
      })
      .execute()

    expect((await claimJob(db, 3))?.videoCid).toBe('bafkstale')
  })

  describe.skipIf(!hasFfmpeg)('worker', () => {
    let pds: { url: string; server: Server }
    let root: string
    let cid: string
    const publicPds = 'https://pds.openreel.test'

    beforeAll(async () => {
      const clips = await mkdtemp(join(tmpdir(), 'media-worker-clip-'))
      makeClip(join(clips, 'clip.mp4'), { width: 720, height: 1280, seconds: 3 })
      const bytes = await readFile(join(clips, 'clip.mp4'))
      cid = blobCid(bytes)
      pds = await fakePds(new Map([[cid, bytes]]))
      root = await mkdtemp(join(tmpdir(), 'media-worker-root-'))
    })

    afterAll(() => {
      pds.server.close()
    })

    function worker(resolvePds: string | null = publicPds): Worker {
      return new Worker({
        db,
        identity: {
          resolve: (d) => Promise.resolve({ did: d, ...(resolvePds ? { pds: resolvePds } : {}) }),
        },
        blobs: new BlobFetcher({ aliases: new Map([[publicPds, pds.url]]), maxBytes: 10_000_000 }),
        store: new FileMediaStore(root),
        transcode,
        maxAttempts: 3,
        pollIntervalMs: 10,
      })
    }

    it('downloads, transcodes, publishes, and marks the blob ready', async () => {
      await addPost(cid)

      expect(await worker().runOnce()).toBe(true)

      const media = await db.selectFrom('video_media').selectAll().executeTakeFirstOrThrow()
      expect(media).toMatchObject({ status: 'ready', width: 720, height: 1280, last_error: null })
      expect(media.duration_ms).toBeGreaterThan(2_900)
      expect((await readdir(join(root, did, cid))).sort()).toEqual([
        'avc_360',
        'avc_720',
        'hevc_720',
        'playlist.m3u8',
        'poster.jpg',
      ])
      // Scratch space is cleaned up.
      expect(await readdir(join(root, '.work'))).toEqual([])
      expect(await worker().runOnce()).toBe(false)
    })

    it('records the failure when scratch space is unavailable', async () => {
      await addPost(cid)
      const broken = new Worker({
        db,
        identity: { resolve: (d) => Promise.resolve({ did: d, pds: publicPds }) },
        blobs: { download: () => Promise.resolve() },
        store: {
          workDir: () => Promise.reject(new Error('EACCES: permission denied')),
          publish: () => Promise.resolve(),
          discard: () => Promise.resolve(),
        },
        transcode,
        maxAttempts: 3,
        pollIntervalMs: 10,
      })

      expect(await broken.runOnce()).toBe(true)
      const media = await db.selectFrom('video_media').selectAll().executeTakeFirstOrThrow()
      expect(media).toMatchObject({ status: 'failed', last_error: 'EACCES: permission denied' })
    })

    it('records the failure when the author has no PDS', async () => {
      await addPost(cid)

      expect(await worker(null).runOnce()).toBe(true)
      const media = await db.selectFrom('video_media').selectAll().executeTakeFirstOrThrow()
      expect(media.status).toBe('failed')
      expect(media.last_error).toMatch(/no PDS endpoint/)
    })
  })
})
