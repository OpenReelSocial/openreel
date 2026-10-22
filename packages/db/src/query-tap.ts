import type { LogEvent } from 'kysely'
import pg from 'pg'

/**
 * Debug-only query tap: with `DEBUG_QUERY_TAP=1`, a service's pool announces
 * every query it runs on this Postgres NOTIFY channel, and the admin service's
 * debug portal LISTENs and shows them live. Postgres is already shared by every
 * service, so this needs no extra infrastructure. It costs one extra round trip
 * per query, so it is for local development and demos only.
 */
export const QUERY_TAP_CHANNEL = 'openreel_query_tap'

/** One query as announced on the tap. */
export interface TappedQuery {
  service: string
  sql: string
  /** Bound parameters, stringified and shortened. */
  params: string[]
  durationMs: number
  /** ISO-8601 time the query finished. */
  at: string
  /** Set when the query failed. */
  error?: string
}

/** Options for {@link createDb}. */
export interface CreateDbOptions {
  /** Announce every query on the tap under this service name. */
  queryTap?: string
}

/** `{ queryTap: service }` when DEBUG_QUERY_TAP=1, otherwise no tap. */
export function queryTapOptions(
  service: string,
  env: NodeJS.ProcessEnv = process.env,
): CreateDbOptions {
  return env['DEBUG_QUERY_TAP'] === '1' ? { queryTap: service } : {}
}

// NOTIFY payloads are limited to 8000 bytes; these caps keep the JSON under it.
const MAX_SQL = 3000
const MAX_PARAMS = 20
const MAX_PARAM = 120

function shorten(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

function describeParam(value: unknown): string {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

/** Builds the tapped form of a Kysely log event. */
export function tappedQuery(service: string, event: LogEvent, at = new Date()): TappedQuery {
  return {
    service,
    sql: shorten(event.query.sql, MAX_SQL),
    params: event.query.parameters
      .slice(0, MAX_PARAMS)
      .map((p) => shorten(describeParam(p), MAX_PARAM)),
    durationMs: Math.round(event.queryDurationMillis * 10) / 10,
    at: at.toISOString(),
    ...(event.level === 'error' ? { error: shorten(String(event.error), 300) } : {}),
  }
}

/**
 * A Kysely `log` function that announces each query through `pool`. The
 * NOTIFY goes through pg directly, not Kysely, so it is not itself logged.
 */
export function queryTapLogger(pool: pg.Pool, service: string): (event: LogEvent) => void {
  return (event) => {
    const payload = JSON.stringify(tappedQuery(service, event))
    pool.query('select pg_notify($1, $2)', [QUERY_TAP_CHANNEL, payload]).catch(() => {
      // A dropped debug event must never affect the service.
    })
  }
}

/**
 * Subscribes to the tap on a dedicated connection. Returns a function that
 * unsubscribes and closes it. `onError` hears about a lost connection, after
 * which nothing more arrives; the caller decides whether to listen again.
 */
export async function listenToQueryTap(
  connectionString: string,
  onQuery: (query: TappedQuery) => void,
  onError: (error: Error) => void = () => {},
): Promise<() => Promise<void>> {
  const client = new pg.Client({ connectionString })
  client.on('error', onError)
  client.on('notification', (message) => {
    if (message.channel !== QUERY_TAP_CHANNEL || message.payload === undefined) return
    try {
      onQuery(JSON.parse(message.payload) as TappedQuery)
    } catch {
      // Ignore payloads that are not ours.
    }
  })
  await client.connect()
  await client.query(`listen ${QUERY_TAP_CHANNEL}`)
  return () => client.end()
}
