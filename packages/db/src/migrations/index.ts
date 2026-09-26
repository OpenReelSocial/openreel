import type { Migration, MigrationProvider } from 'kysely/migration'

import * as initialSchema from './0001_initial_schema.ts'

/**
 * Every migration, keyed by name. Kysely applies migrations in the lexical order
 * of their keys and records the applied names in `kysely_migration`, so:
 *
 * - names are `NNNN_snake_case_description` with a zero-padded prefix that
 *   sorts after every existing entry;
 * - a migration is never renamed, removed, or edited once it has merged to
 *   `main`. Schema changes are new migrations;
 * - every migration has a `down` so `resetDatabase` can unwind it.
 *
 * Migrations are registered here explicitly rather than discovered from the
 * filesystem so the compiled `dist/` output needs no directory scanning and the
 * list is visible in one place.
 */
export const migrations: Record<string, Migration> = {
  '0001_initial_schema': initialSchema,
}

/** A `MigrationProvider` backed by the in-memory {@link migrations} map. */
export const migrationProvider: MigrationProvider = {
  getMigrations: () => Promise.resolve(migrations),
}
