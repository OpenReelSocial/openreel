import { describe, expect, it } from 'vitest'

import { assertResetAllowed, CliError, parseCommand, readDatabaseUrl, runCli } from '../src/cli.ts'

describe('parseCommand', () => {
  it.each(['migrate', 'reset', 'status'] as const)('accepts %s', (command) => {
    expect(parseCommand([command])).toBe(command)
  })

  it('rejects a missing command', () => {
    expect(() => parseCommand([])).toThrow(CliError)
    expect(() => parseCommand([])).toThrow(/missing command/)
  })

  it('rejects an unknown command', () => {
    expect(() => parseCommand(['drop'])).toThrow(/unknown command "drop"/)
  })

  it('rejects extra arguments', () => {
    expect(() => parseCommand(['migrate', '--force'])).toThrow(/unexpected arguments/)
  })
})

describe('readDatabaseUrl', () => {
  it('returns the configured URL', () => {
    expect(readDatabaseUrl({ DATABASE_URL: 'postgres://x' })).toBe('postgres://x')
  })

  it('rejects unset or blank', () => {
    expect(() => readDatabaseUrl({})).toThrow(/DATABASE_URL is not set/)
    expect(() => readDatabaseUrl({ DATABASE_URL: '  ' })).toThrow(/DATABASE_URL is not set/)
  })
})

describe('assertResetAllowed', () => {
  it('allows reset outside production', () => {
    expect(() => assertResetAllowed({})).not.toThrow()
    expect(() => assertResetAllowed({ NODE_ENV: 'development' })).not.toThrow()
    expect(() => assertResetAllowed({ NODE_ENV: 'test' })).not.toThrow()
  })

  it('refuses reset in production', () => {
    expect(() => assertResetAllowed({ NODE_ENV: 'production' })).toThrow(/refusing to reset/)
  })
})

describe('runCli', () => {
  // These paths fail before a connection is attempted, so no database is needed.
  it('refuses reset in production before reading DATABASE_URL', async () => {
    await expect(
      runCli(['reset'], { NODE_ENV: 'production', DATABASE_URL: 'postgres://x' }, () => {}),
    ).rejects.toThrow(/refusing to reset/)
  })

  it('requires DATABASE_URL', async () => {
    await expect(runCli(['migrate'], {}, () => {})).rejects.toThrow(/DATABASE_URL is not set/)
  })

  it('rejects bad arguments before anything else', async () => {
    await expect(runCli(['nope'], {}, () => {})).rejects.toThrow(/unknown command/)
  })
})
