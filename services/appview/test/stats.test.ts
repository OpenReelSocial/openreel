import { sql, type Kysely } from 'kysely'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { closeDb, createDb, resetDatabase, type Database } from '@openreel/db'

import { refreshStats } from '../src/indexer/indexer.ts'

/**
 * Runs `refreshStats` against a real Postgres when TEST_DATABASE_URL is set
 * (see packages/db/test/integration.test.ts), in its own database beside the
 * one the URL names so it cannot race other packages' database suites.
 */
const url = process.env['TEST_DATABASE_URL']
const hasDb = url !== undefined && url !== ''

const AUTHOR = 'did:plc:statstest0000000000000001'
const POST = `at://${AUTHOR}/social.openreel.video.post/1`

describe.skipIf(!hasDb)('refreshStats against Postgres', () => {
  let db: Kysely<Database>
  let rkey = 0

  beforeAll(async () => {
    db = await ownDatabase(url ?? '', 'appview_stats')
    await resetDatabase(db)
  })

  afterAll(async () => {
    await closeDb(db)
  })

  beforeEach(async () => {
    await sql`truncate video_post_stats, video_like, watch_event, video_post, actor`.execute(db)
    await db.insertInto('actor').values({ did: AUTHOR, handle: 'author.test' }).execute()
    await db
      .insertInto('video_post')
      .values({ uri: POST, cid: 'cid-post', author_did: AUTHOR, created_at: new Date() })
      .execute()
  })

  async function actor(name: string): Promise<string> {
    const did = `did:plc:${name.padEnd(24, '0')}`
    await db
      .insertInto('actor')
      .values({ did, handle: `${name}.test` })
      .onConflict((oc) => oc.column('did').doNothing())
      .execute()
    return did
  }

  async function watch(did: string, completion: number): Promise<void> {
    rkey += 1
    await db
      .insertInto('watch_event')
      .values({
        uri: `at://${did}/social.openreel.engagement.watchEvent/${rkey}`,
        cid: `cid-${rkey}`,
        actor_did: did,
        subject_uri: POST,
        completion_rate: completion,
        created_at: new Date(),
      })
      .execute()
  }

  async function like(did: string): Promise<void> {
    rkey += 1
    await db
      .insertInto('video_like')
      .values({
        uri: `at://${did}/social.openreel.engagement.like/${rkey}`,
        cid: `cid-${rkey}`,
        actor_did: did,
        subject_uri: POST,
        created_at: new Date(),
      })
      .execute()
  }

  async function stats() {
    await refreshStats(db, [POST])
    return db
      .selectFrom('video_post_stats')
      .select(['view_count', 'like_count', 'viewer_count', 'viewer_like_count'])
      .where('uri', '=', POST)
      .executeTakeFirstOrThrow()
  }

  it('gives a post with no events zeros', async () => {
    expect(await stats()).toEqual({
      view_count: 0,
      like_count: 0,
      viewer_count: 0,
      viewer_like_count: 0,
    })
  })

  it('counts a rewatch as one viewer but two views', async () => {
    const viewer = await actor('rewatcher')
    await watch(viewer, 1)
    await watch(viewer, 0.5)

    expect(await stats()).toMatchObject({ view_count: 2, viewer_count: 1 })
  })

  it('counts only likes from accounts that shared a watch toward the ratio', async () => {
    const sharer = await actor('sharer')
    const lurker = await actor('lurker')
    const watcher = await actor('watcher')
    await watch(sharer, 0.9)
    await like(sharer)
    await like(sharer) // a second like from the same account counts once
    await like(lurker) // liked without publishing a watch event
    await watch(watcher, 0.4)

    expect(await stats()).toEqual({
      view_count: 2,
      like_count: 2,
      viewer_count: 2,
      viewer_like_count: 1,
    })
  })
})

/** A database named `<base>_<suffix>` on the same server, created if missing. */
async function ownDatabase(baseUrl: string, suffix: string): Promise<Kysely<Database>> {
  const target = new URL(baseUrl)
  const name = `${target.pathname.slice(1) || 'postgres'}_${suffix}`
  const admin = createDb(baseUrl)
  try {
    const exists = await sql<{
      n: number
    }>`select 1 as n from pg_database where datname = ${name}`.execute(admin)
    if (exists.rows.length === 0) await sql`create database ${sql.id(name)}`.execute(admin)
  } finally {
    await closeDb(admin)
  }
  target.pathname = `/${name}`
  return createDb(target.toString())
}
