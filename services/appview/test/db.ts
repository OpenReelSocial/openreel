import { closeDb, createDb, migrateToLatest, type Database } from '@openreel/db'
import { sql, type Kysely } from 'kysely'

/**
 * DB-backed suites run when TEST_DATABASE_URL is set (see
 * packages/db/test/integration.test.ts). Each works in its own database beside
 * that one, recreated per run, so suites never race each other or the db
 * package's suite when turbo and vitest run them in parallel.
 */
export const testDatabaseUrl = process.env['TEST_DATABASE_URL'] ?? ''
export const hasDb = testDatabaseUrl !== ''

export async function freshDatabase(
  name: string,
): Promise<{ db: Kysely<Database>; drop: () => Promise<void> }> {
  const admin = createDb(testDatabaseUrl)
  await sql`drop database if exists ${sql.id(name)}`.execute(admin)
  await sql`create database ${sql.id(name)}`.execute(admin)
  const url = new URL(testDatabaseUrl)
  url.pathname = `/${name}`
  const db = createDb(url.toString())
  await migrateToLatest(db)
  return {
    db,
    drop: async () => {
      await closeDb(db)
      await sql`drop database if exists ${sql.id(name)}`.execute(admin)
      await closeDb(admin)
    },
  }
}
