import { sql, type Kysely } from 'kysely'
import { NO_MIGRATIONS } from 'kysely/migration'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { closeDb, createDb, type Database } from '../src/database.ts'
import {
  createMigrator,
  getMigrationStatus,
  migrateToLatest,
  resetDatabase,
} from '../src/migrate.ts'
import { migrations } from '../src/migrations/index.ts'

/**
 * Runs against a real Postgres when TEST_DATABASE_URL is set, for example:
 *
 *   TEST_DATABASE_URL=postgres://openreel:test@localhost:55432/openreel pnpm test
 *
 * Deliberately not keyed on DATABASE_URL: this suite drops every table, and a
 * developer's shell may carry DATABASE_URL pointing at the Compose database.
 * Without the variable the suite is skipped so `make test` stays hermetic.
 */
const url = process.env['TEST_DATABASE_URL']
const hasDb = url !== undefined && url !== ''

const EXPECTED_TABLES = ['actor', 'video_post', 'video_post_stats', 'watch_event']

describe.skipIf(!hasDb)('migrations against Postgres', () => {
  let db: Kysely<Database>

  beforeAll(async () => {
    db = createDb(url ?? '')
    // Start from nothing so a previous failed run cannot leak state in.
    await createMigrator(db).migrateTo(NO_MIGRATIONS)
  })

  afterAll(async () => {
    await closeDb(db)
  })

  it('applies every migration to an empty database', async () => {
    const results = await migrateToLatest(db)

    expect(results.map((r) => r.migrationName)).toEqual(Object.keys(migrations))
    expect(results.every((r) => r.status === 'Success')).toBe(true)
    expect(await publicTables(db)).toEqual(EXPECTED_TABLES)
  })

  it('is a no-op when already at the latest', async () => {
    expect(await migrateToLatest(db)).toEqual([])

    const status = await getMigrationStatus(db)
    expect(status.every((m) => m.executedAt instanceof Date)).toBe(true)
  })

  it('round-trips rows through the typed query layer', async () => {
    const did = 'did:plc:integrationtest0000000001'
    const postUri = `at://${did}/social.openreel.video.post/3abc`

    await db.insertInto('actor').values({ did, handle: 'alice.test' }).execute()
    await db
      .insertInto('video_post')
      .values({
        uri: postUri,
        cid: 'bafyreiaaaa',
        author_did: did,
        caption: 'hello',
        duration_ms: 12_000,
        video_cid: 'bafkreivideo',
        thumbnail_cid: null,
        created_at: new Date('2026-09-15T12:00:00Z'),
      })
      .execute()
    await db
      .insertInto('watch_event')
      .values({
        uri: `at://${did}/social.openreel.engagement.watchEvent/3def`,
        cid: 'bafyreibbbb',
        actor_did: did,
        subject_uri: postUri,
        subject_cid: 'bafyreiaaaa',
        watch_duration_ms: 9_000,
        completion_rate: 0.75,
        sound_enabled: true,
        rewatch_count: 0,
        created_at: new Date('2026-09-15T12:01:00Z'),
      })
      .execute()
    await db.insertInto('video_post_stats').values({ uri: postUri, view_count: 3 }).execute()

    const row = await db
      .selectFrom('video_post')
      .innerJoin('actor', 'actor.did', 'video_post.author_did')
      .innerJoin('video_post_stats', 'video_post_stats.uri', 'video_post.uri')
      .select([
        'video_post.caption',
        'actor.handle',
        'video_post_stats.view_count',
        'video_post.created_at',
      ])
      .where('video_post.uri', '=', postUri)
      .executeTakeFirstOrThrow()

    expect(row).toMatchObject({ caption: 'hello', handle: 'alice.test' })
    // bigint comes back as a number, not the pg default string.
    expect(row.view_count).toBe(3)
    expect(row.created_at).toBeInstanceOf(Date)
    expect(row.created_at.toISOString()).toBe('2026-09-15T12:00:00.000Z')

    const watch = await db
      .selectFrom('watch_event')
      .select(['completion_rate', 'sound_enabled'])
      .where('subject_uri', '=', postUri)
      .executeTakeFirstOrThrow()
    expect(watch.completion_rate).toBeCloseTo(0.75)
    expect(watch.sound_enabled).toBe(true)
  })

  it('enforces the actor foreign key', async () => {
    await expect(
      db
        .insertInto('video_post')
        .values({
          uri: 'at://did:plc:nobody/social.openreel.video.post/1',
          cid: 'x',
          author_did: 'did:plc:nobody',
          created_at: new Date(),
        })
        .execute(),
    ).rejects.toThrow(/foreign key/)
  })

  it('resets to an empty database at the latest schema', async () => {
    const results = await resetDatabase(db)

    expect(results.filter((r) => r.direction === 'Down')).toHaveLength(
      Object.keys(migrations).length,
    )
    expect(results.filter((r) => r.direction === 'Up')).toHaveLength(Object.keys(migrations).length)
    expect(await publicTables(db)).toEqual(EXPECTED_TABLES)

    const count = await db
      .selectFrom('actor')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .executeTakeFirstOrThrow()
    expect(count.n).toBe(0)
  })

  it('migrates all the way down', async () => {
    const { error } = await createMigrator(db).migrateTo(NO_MIGRATIONS)

    expect(error).toBeUndefined()
    expect(await publicTables(db)).toEqual([])
  })
})

/** Tables in `public`, excluding Kysely's own bookkeeping, sorted. */
async function publicTables(db: Kysely<Database>): Promise<string[]> {
  const { rows } = await sql<{ table_name: string }>`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
      and table_name not like 'kysely_migration%'
    order by table_name
  `.execute(db)
  return rows.map((r) => r.table_name)
}
