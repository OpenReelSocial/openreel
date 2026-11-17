import { closeDb, createDb, migrateToLatest, type Database } from '@openreel/db'
import { sql, type Kysely } from 'kysely'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { MediaStore } from '../src/store.ts'
import { Worker } from '../src/worker.ts'

/**
 * The worker's removal queue against a real Postgres. Runs when
 * TEST_DATABASE_URL is set (see packages/db/test/integration.test.ts), in its
 * own database beside that one so suites do not race.
 */
const url = process.env['TEST_DATABASE_URL'] ?? ''
const NAME = 'openreel_media_removal_test'

const DID = 'did:plc:author0000000000000000000'

describe.skipIf(url === '')('rendition removal against Postgres', () => {
  let admin: Kysely<Database>
  let db: Kysely<Database>
  const removed: string[] = []
  const invalidated: string[] = []
  let failRemove = false

  const store: MediaStore = {
    name: 'disk',
    workDir: () => Promise.reject(new Error('no transcoding here')),
    publish: () => Promise.reject(new Error('no transcoding here')),
    discard: () => Promise.resolve(),
    remove: (did, cid) =>
      failRemove
        ? Promise.reject(new Error('store down'))
        : (removed.push(`${did}/${cid}`), Promise.resolve()),
  }
  const worker = () =>
    new Worker({
      db,
      identity: { resolve: (did) => Promise.resolve({ did }) },
      blobs: { download: () => Promise.reject(new Error('no downloads here')) },
      store,
      cdn: {
        invalidate: (did, cid) => {
          invalidated.push(`${did}/${cid}`)
          return Promise.resolve()
        },
      },
      transcode: () => Promise.reject(new Error('no transcoding here')),
      maxAttempts: 3,
      pollIntervalMs: 1000,
    })

  beforeAll(async () => {
    admin = createDb(url)
    await sql`drop database if exists ${sql.id(NAME)}`.execute(admin)
    await sql`create database ${sql.id(NAME)}`.execute(admin)
    const own = new URL(url)
    own.pathname = `/${NAME}`
    db = createDb(own.toString())
    await migrateToLatest(db)
  })

  afterAll(async () => {
    await closeDb(db)
    await sql`drop database if exists ${sql.id(NAME)}`.execute(admin)
    await closeDb(admin)
  })

  beforeEach(async () => {
    removed.length = 0
    invalidated.length = 0
    failRemove = false
    await sql`truncate video_media`.execute(db)
  })

  it('deletes renditions, invalidates the CDN, then forgets the blob', async () => {
    await db
      .insertInto('video_media')
      .values([
        { author_did: DID, video_cid: 'bafkreigone', status: 'removing' },
        { author_did: DID, video_cid: 'bafkreikept', status: 'ready' },
      ])
      .execute()

    expect(await worker().runOnce()).toBe(true)
    expect(removed).toEqual([`${DID}/bafkreigone`])
    expect(invalidated).toEqual([`${DID}/bafkreigone`])
    const left = await db.selectFrom('video_media').select('video_cid').execute()
    expect(left).toEqual([{ video_cid: 'bafkreikept' }])
    // Nothing else to do: the ready blob is not touched.
    expect(await worker().runOnce()).toBe(false)
  })

  it('keeps the claim on failure so the removal is retried later', async () => {
    await db
      .insertInto('video_media')
      .values({ author_did: DID, video_cid: 'bafkreigone', status: 'removing' })
      .execute()
    failRemove = true

    expect(await worker().runOnce()).toBe(true)
    const row = await db.selectFrom('video_media').selectAll().executeTakeFirstOrThrow()
    expect(row.status).toBe('removing')
    expect(row.claimed_at).not.toBeNull()
    expect(invalidated).toEqual([])
    // Claimed recently, so not picked up again at once.
    failRemove = false
    expect(await worker().runOnce()).toBe(false)
  })

  it('keeps a blob a post started using again during removal', async () => {
    await db
      .insertInto('video_media')
      .values({ author_did: DID, video_cid: 'bafkreiback', status: 'removing' })
      .execute()
    store.remove = async (did, cid) => {
      removed.push(`${did}/${cid}`)
      // What the AppView's indexer does when a new post uses the blob.
      await db.updateTable('video_media').set({ status: 'pending' }).execute()
    }

    await worker().runOnce()
    const row = await db.selectFrom('video_media').select('status').executeTakeFirst()
    expect(row?.status).toBe('pending')
  })
})
