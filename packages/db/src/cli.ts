import { pathToFileURL } from 'node:url'

import { closeDb, createDb } from './database.ts'
import { getMigrationStatus, migrateToLatest, resetDatabase } from './migrate.ts'

/**
 * Migration CLI, invoked by the `make db-*` targets as `node dist/cli.js`.
 *
 *   migrate   apply pending migrations
 *   reset     roll every migration back, then re-apply (destructive; refused
 *             when NODE_ENV=production)
 *   status    list migrations and when each was applied
 *
 * The connection string comes from DATABASE_URL.
 */

export const COMMANDS = ['migrate', 'reset', 'status'] as const
export type Command = (typeof COMMANDS)[number]

export const USAGE = `usage: node dist/cli.js <${COMMANDS.join('|')}>   (reads DATABASE_URL)`

/** Raised for operator mistakes: bad arguments, missing config, refused actions. */
export class CliError extends Error {}

/** Extracts the single command from `argv` (without the node and script entries). */
export function parseCommand(argv: readonly string[]): Command {
  const [command, ...rest] = argv
  if (command === undefined) throw new CliError(`missing command\n${USAGE}`)
  if (rest.length > 0) throw new CliError(`unexpected arguments: ${rest.join(' ')}\n${USAGE}`)
  if (!isCommand(command)) throw new CliError(`unknown command "${command}"\n${USAGE}`)
  return command
}

function isCommand(value: string): value is Command {
  return (COMMANDS as readonly string[]).includes(value)
}

type Env = Readonly<Record<string, string | undefined>>

export function readDatabaseUrl(env: Env): string {
  const url = env['DATABASE_URL']
  if (url === undefined || url.trim() === '') {
    throw new CliError('DATABASE_URL is not set')
  }
  return url
}

/** `reset` drops every table, so it is refused outright in production. */
export function assertResetAllowed(env: Env): void {
  if (env['NODE_ENV'] === 'production') {
    throw new CliError('refusing to reset the database with NODE_ENV=production')
  }
}

/**
 * Runs one command end to end. Validation that needs no database (arguments,
 * the production guard, DATABASE_URL presence) happens before a connection is
 * opened, so a refused command never touches the database.
 */
export async function runCli(
  argv: readonly string[],
  env: Env,
  log: (line: string) => void = console.log,
): Promise<void> {
  const command = parseCommand(argv)
  if (command === 'reset') assertResetAllowed(env)
  const db = createDb(readDatabaseUrl(env))

  try {
    switch (command) {
      case 'migrate': {
        const results = await migrateToLatest(db)
        if (results.length === 0) log('No pending migrations.')
        for (const r of results) log(`${r.status.padEnd(9)} ${r.migrationName}`)
        break
      }
      case 'reset': {
        const results = await resetDatabase(db)
        for (const r of results)
          log(`${r.status.padEnd(9)} ${r.direction.padEnd(5)} ${r.migrationName}`)
        log('Database reset to the latest schema.')
        break
      }
      case 'status': {
        const infos = await getMigrationStatus(db)
        for (const info of infos) {
          const applied = info.executedAt ? `applied ${info.executedAt.toISOString()}` : 'pending'
          log(`${applied.padEnd(33)} ${info.name}`)
        }
        const pending = infos.filter((i) => i.executedAt === undefined).length
        log(`${infos.length} migration(s), ${pending} pending.`)
        break
      }
    }
  } finally {
    await closeDb(db)
  }
}

async function main(): Promise<void> {
  try {
    await runCli(process.argv.slice(2), process.env)
  } catch (error) {
    if (error instanceof CliError) {
      console.error(`error: ${error.message}`)
    } else {
      console.error(error)
    }
    process.exitCode = 1
  }
}

// Only run when executed directly, not when imported by tests or other code.
const entry = process.argv[1]
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  void main()
}
