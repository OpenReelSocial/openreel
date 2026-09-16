import type { Kysely } from 'kysely'
import {
  Migrator,
  NO_MIGRATIONS,
  type MigrationInfo,
  type MigrationResult,
  type MigrationResultSet,
} from 'kysely/migration'

import type { Database } from './database.ts'
import { migrationProvider } from './migrations/index.ts'

/** Builds the Kysely migrator over the committed migrations map. */
export function createMigrator(db: Kysely<Database>): Migrator {
  return new Migrator({ db, provider: migrationProvider })
}

/**
 * Applies every migration that has not yet run, in order. Throws if any
 * migration fails; the ones that succeeded before it stay applied, which
 * Kysely reports as the results on the thrown error's cause.
 */
export async function migrateToLatest(db: Kysely<Database>): Promise<MigrationResult[]> {
  return unwrap(await createMigrator(db).migrateToLatest(), 'migrateToLatest')
}

/**
 * Rolls back every applied migration, then re-applies all of them, leaving an
 * empty database at the current schema.
 *
 * DESTRUCTIVE: every row in every migrated table is dropped. This is for local
 * development and test databases only; the CLI refuses to run it under
 * `NODE_ENV=production`, and nothing in the deployed services calls it.
 */
export async function resetDatabase(db: Kysely<Database>): Promise<MigrationResult[]> {
  const migrator = createMigrator(db)
  const down = unwrap(await migrator.migrateTo(NO_MIGRATIONS), 'resetDatabase (down)')
  const up = unwrap(await migrator.migrateToLatest(), 'resetDatabase (up)')
  return [...down, ...up]
}

/** Lists every known migration with the time it was applied, if it has been. */
export async function getMigrationStatus(db: Kysely<Database>): Promise<readonly MigrationInfo[]> {
  return createMigrator(db).getMigrations()
}

function unwrap({ error, results }: MigrationResultSet, operation: string): MigrationResult[] {
  if (error !== undefined) {
    const failed = results?.find((r) => r.status === 'Error')
    const detail = failed ? ` in migration "${failed.migrationName}"` : ''
    throw new Error(`${operation} failed${detail}: ${describe(error)}`, { cause: error })
  }
  return results ?? []
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
