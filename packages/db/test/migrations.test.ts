import { describe, expect, it } from 'vitest'

import { migrationProvider, migrations } from '../src/migrations/index.ts'

describe('migrations map', () => {
  const names = Object.keys(migrations)

  it('contains the initial schema', () => {
    expect(names).toContain('0001_initial_schema')
  })

  it('uses sortable, zero-padded snake_case names', () => {
    for (const name of names) expect(name).toMatch(/^\d{4}_[a-z0-9_]+$/)
  })

  it('is registered in the order Kysely will apply it', () => {
    expect(names).toEqual([...names].sort())
  })

  it('has no duplicate numeric prefixes', () => {
    const prefixes = names.map((n) => n.slice(0, 4))
    expect(new Set(prefixes).size).toBe(prefixes.length)
  })

  it('defines up and down for every migration so reset can unwind it', () => {
    for (const migration of Object.values(migrations)) {
      expect(typeof migration.up).toBe('function')
      expect(typeof migration.down).toBe('function')
    }
  })

  it('is what the provider hands to Kysely', async () => {
    await expect(migrationProvider.getMigrations()).resolves.toBe(migrations)
  })
})
