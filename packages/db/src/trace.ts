import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'

import type { CompiledQuery, KyselyPlugin, LogEvent, OperationNode, QueryId } from 'kysely'
import pg from 'pg'

/**
 * Debug-only tracing for the admin service's system map (`/debug`).
 *
 * With `DEBUG_QUERY_TAP=1`, a service groups what it does into traces: one per
 * inbound request, firehose event, or transcode job. Every SQL statement,
 * outbound call, and upload inside a trace is announced on this Postgres
 * NOTIFY channel, labelled with what the code was doing ({@link purpose}).
 * The admin service LISTENs and assembles the traces. Postgres is already
 * shared by every service, so this needs no extra infrastructure. It costs a
 * round trip per event, so it is for local development and demos only.
 */
export const TRACE_CHANNEL = 'openreel_trace'

/** Carries a trace from one service to the next on internal HTTP calls. */
export const TRACE_HEADER = 'x-openreel-trace'
/** Names the calling service on internal HTTP calls. */
export const CALLER_HEADER = 'x-openreel-caller'

/** Fields every trace event carries. */
interface EventBase {
  service: string
  /** The trace this belongs to; absent for background work such as polling. */
  trace?: string
  /** What the code was doing, as labelled where the call is made. */
  purpose?: string
  /** ISO-8601 time it started. */
  at: string
  ms: number
  /** Set when it failed. */
  error?: string
}

export type SqlOp = 'select' | 'insert' | 'upsert' | 'update' | 'delete' | 'other'

export interface SqlEvent extends EventBase {
  kind: 'sql'
  op: SqlOp
  /** The table an insert, update, or delete changes. */
  writes?: string
  /** Tables read, including those a write reads from. */
  reads: string[]
  /** Rows returned, or changed by a write. */
  rows?: number
  sql: string
  /** Bound parameters, stringified and shortened. */
  params: string[]
}

/** An inbound HTTP request. Without `from` it starts a trace. */
export interface RequestEvent extends EventBase {
  kind: 'request'
  method: string
  path: string
  status: number
  /** The OpenReel service that made the call, when it was one. */
  from?: string
  /** First token of the User-Agent header. */
  client?: string
}

/** A Jetstream event being indexed. Starts a trace. */
export interface FirehoseEvent extends EventBase {
  kind: 'firehose'
  event: 'commit' | 'identity' | 'account'
  did: string
  op?: string
  collection?: string
  uri?: string
  /** Time from Jetstream receiving the event to the indexer starting on it. */
  relayMs: number
}

/** A background job. Starts a trace. */
export interface JobEvent extends EventBase {
  kind: 'job'
  name: string
  did: string
  subject: string
}

/** An outbound HTTP call to another server. */
export interface CallEvent extends EventBase {
  kind: 'call'
  target: string
  method: string
  path: string
  status?: number
  bytes?: number
}

/** Files written to media storage. */
export interface StoreEvent extends EventBase {
  kind: 'store'
  target: string
  objects?: number
  bytes?: number
}

/** Local work that is neither a query nor a call, such as transcoding. */
export interface WorkEvent extends EventBase {
  kind: 'work'
  what: string
}

export type TraceEvent =
  SqlEvent | RequestEvent | FirehoseEvent | JobEvent | CallEvent | StoreEvent | WorkEvent

/** Whether an event starts a trace; the admin service finishes a trace when its root arrives. */
export function isRootEvent(event: TraceEvent): boolean {
  return (
    event.kind === 'firehose' ||
    event.kind === 'job' ||
    (event.kind === 'request' && event.from === undefined)
  )
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

/** What the caller supplies; timing, service, and trace are filled in. */
type Fields<E extends TraceEvent> = DistributiveOmit<E, keyof EventBase>

type Unpublished = DistributiveOmit<TraceEvent, 'service'>

interface Context {
  trace?: string
  purpose?: string
}

const context = new AsyncLocalStorage<Context>()

interface Sink {
  service: string
  publish: (event: TraceEvent) => void
}

// One service per process, so one sink, installed by createDb when the tap is on.
let sink: Sink | undefined

/** Sends this process's trace events to `publish`, or stops tracing with `undefined`. */
export function setTraceSink(service: string, publish: (event: TraceEvent) => void): void
export function setTraceSink(off: undefined): void
export function setTraceSink(
  service: string | undefined,
  publish?: (event: TraceEvent) => void,
): void {
  sink = service === undefined || publish === undefined ? undefined : { service, publish }
}

function emit(event: Unpublished): void {
  if (sink === undefined) return
  try {
    sink.publish({ service: sink.service, ...event })
  } catch {
    // A dropped debug event must never affect the service.
  }
}

const round = (ms: number): number => Math.round(ms * 10) / 10

function shorten(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

const errorText = (error: unknown): string =>
  shorten(error instanceof Error ? error.message : String(error), 300)

/** Runs `fn`, then emits `fields` with its timing and anything `fn` noted. */
async function timed<T>(
  fields: object,
  trace: string | undefined,
  fn: (note: (more: object) => void) => Promise<T>,
): Promise<T> {
  const at = new Date().toISOString()
  const started = performance.now()
  const extra = {}
  let error: string | undefined
  try {
    return await fn((more) => Object.assign(extra, more))
  } catch (caught) {
    error = errorText(caught)
    throw caught
  } finally {
    emit({
      ...fields,
      ...extra,
      ...(trace === undefined ? {} : { trace }),
      at,
      ms: round(performance.now() - started),
      ...(error === undefined ? {} : { error }),
    } as Unpublished)
  }
}

/**
 * Runs `fn` as a new trace: a firehose event being indexed or a background
 * job. Everything it does is grouped under the trace. A no-op without a sink.
 */
export function traceRoot<T>(
  fields: Fields<FirehoseEvent> | Fields<JobEvent>,
  fn: () => Promise<T>,
): Promise<T> {
  if (sink === undefined) return fn()
  const trace = randomUUID()
  return timed(fields, trace, () => context.run({ trace }, fn))
}

/**
 * Labels the queries `fn` runs with what they are for, as the system map shows
 * them: "Record the like", not `insert into "video_like"`.
 */
export function purpose<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (sink === undefined) return fn()
  return context.run({ ...context.getStore(), purpose: label }, fn)
}

/**
 * Times one outbound call, upload, or piece of local work, labelled with its
 * purpose. `fn` can `note` what it learns on the way, such as a status code.
 */
export function traceStep<T, E extends CallEvent | StoreEvent | WorkEvent>(
  label: string,
  fields: Fields<E>,
  fn: (note: (more: Partial<Fields<E>>) => void) => Promise<T>,
): Promise<T> {
  if (sink === undefined) return fn(() => {})
  const store = context.getStore()
  return timed({ ...fields, purpose: label }, store?.trace, (note) =>
    context.run({ ...store, purpose: label }, () => fn(note)),
  )
}

/** Headers that carry the current trace on a call to another OpenReel service. */
export function traceHeaders(): Record<string, string> {
  const trace = context.getStore()?.trace
  if (sink === undefined || trace === undefined) return {}
  return { [TRACE_HEADER]: trace, [CALLER_HEADER]: sink.service }
}

// Structural types so the middleware works with Express without depending on it.
interface RequestLike {
  method: string
  originalUrl?: string
  url?: string
  headers: Record<string, string | string[] | undefined>
}
interface ResponseLike {
  statusCode: number
  once(event: 'finish' | 'close', listener: () => void): unknown
}

const TRACE_ID = /^[\w-]{1,64}$/
const SERVICE_NAME = /^[a-z][a-z-]{0,31}$/

const header = (req: RequestLike, name: string): string | undefined => {
  const value = req.headers[name]
  return typeof value === 'string' ? value : undefined
}

/**
 * Express middleware: each request becomes a trace, or joins the caller's
 * when another OpenReel service sent {@link traceHeaders}. Mount it after the
 * health routes so container health checks stay out of the picture.
 */
export function traceRequests() {
  return (req: RequestLike, res: ResponseLike, next: () => void): void => {
    if (sink === undefined) {
      next()
      return
    }
    const parent = header(req, TRACE_HEADER)
    const caller = header(req, CALLER_HEADER)
    const joined = parent !== undefined && TRACE_ID.test(parent)
    const trace = joined ? parent : randomUUID()
    const client = header(req, 'user-agent')?.split(' ')[0]
    const at = new Date().toISOString()
    const started = performance.now()

    let done = false
    const finish = (): void => {
      if (done) return
      done = true
      emit({
        kind: 'request',
        trace,
        method: req.method,
        path: shorten(req.originalUrl ?? req.url ?? '', 300),
        status: res.statusCode,
        ...(joined && caller !== undefined && SERVICE_NAME.test(caller) ? { from: caller } : {}),
        ...(client ? { client: shorten(client, 40) } : {}),
        at,
        ms: round(performance.now() - started),
      })
    }
    res.once('finish', finish)
    res.once('close', finish)
    context.run({ trace }, next)
  }
}

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

interface QueryShape {
  op: SqlOp
  writes?: string
  reads: string[]
}

function isNode(value: unknown): value is OperationNode {
  return typeof value === 'object' && value !== null && 'kind' in value
}

/**
 * Every table a query node reads or writes, in order of first appearance.
 * Column references (`p.uri`) also hold a table node, naming the alias, so
 * they are skipped.
 */
function tablesIn(node: unknown, found = new Set<string>()): string[] {
  if (Array.isArray(node)) {
    for (const item of node) tablesIn(item, found)
  } else if (isNode(node) && node.kind !== 'ReferenceNode') {
    if (node.kind === 'TableNode') {
      const name = (node as { table?: { identifier?: { name?: unknown } } }).table?.identifier?.name
      if (typeof name === 'string') found.add(name)
    }
    for (const value of Object.values(node)) {
      if (typeof value === 'object' && value !== null) tablesIn(value, found)
    }
  }
  return [...found]
}

const TRANSACTION_CONTROL = /^\s*(begin|commit|rollback|savepoint|release)\b/i
const WRITE_SQL = /^\s*(insert\s+into|update|delete\s+from)\s+"?(\w+)"?/i
const READ_TABLES = /\b(?:from|join)\s+"?(\w+)"?/gi

/** Shape of a raw `sql` query, read from its text. */
function shapeOfSql(text: string): QueryShape {
  const reads = new Set([...text.matchAll(READ_TABLES)].map((m) => m[1] as string))
  const write = WRITE_SQL.exec(text)
  if (write === null) {
    return { op: /^\s*(select|with)\b/i.test(text) ? 'select' : 'other', reads: [...reads] }
  }
  const verb = (write[1] as string).toLowerCase()
  const writes = write[2] as string
  reads.delete(writes)
  const op: SqlOp = verb.startsWith('insert')
    ? /\bon\s+conflict\b/i.test(text)
      ? 'upsert'
      : 'insert'
    : verb === 'update'
      ? 'update'
      : 'delete'
  return { op, writes, reads: [...reads] }
}

/**
 * What a query does and to which tables, from Kysely's query tree; raw `sql`
 * queries are read from their text. Undefined for transaction control.
 */
export function describeQuery(query: CompiledQuery): QueryShape | undefined {
  const node = query.query
  const written = (target: unknown, op: SqlOp): QueryShape => {
    const writes = tablesIn(target)[0]
    const reads = tablesIn(node).filter((t) => t !== writes)
    return writes === undefined ? { op, reads } : { op, writes, reads }
  }
  switch (node.kind) {
    case 'SelectQueryNode':
      return { op: 'select', reads: tablesIn(node) }
    case 'InsertQueryNode':
      return written(node.into, node.onConflict === undefined ? 'insert' : 'upsert')
    case 'UpdateQueryNode':
      return written(node.table, 'update')
    case 'DeleteQueryNode':
      return written(node.from, 'delete')
    case 'RawNode':
      return TRANSACTION_CONTROL.test(query.sql) ? undefined : shapeOfSql(query.sql)
    default:
      return { op: 'other', reads: [] }
  }
}

// NOTIFY payloads are limited to 8000 bytes; these caps keep the JSON under it.
const MAX_SQL = 2000
const MAX_PARAMS = 16
const MAX_PARAM = 100
const MAX_PAYLOAD_BYTES = 7900

function describeParam(value: unknown): string {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

/** Builds the trace form of a Kysely log event, or undefined for transaction control. */
export function sqlEvent(
  event: LogEvent,
  finishedAt = Date.now(),
): Omit<SqlEvent, 'service'> | undefined {
  const shape = describeQuery(event.query)
  if (shape === undefined) return undefined
  const store = context.getStore()
  return {
    kind: 'sql',
    ...shape,
    sql: shorten(event.query.sql, MAX_SQL),
    params: event.query.parameters
      .slice(0, MAX_PARAMS)
      .map((p) => shorten(describeParam(p), MAX_PARAM)),
    ...(store?.trace === undefined ? {} : { trace: store.trace }),
    ...(store?.purpose === undefined ? {} : { purpose: store.purpose }),
    at: new Date(finishedAt - event.queryDurationMillis).toISOString(),
    ms: round(event.queryDurationMillis),
    ...(event.level === 'error' ? { error: errorText(event.error) } : {}),
  }
}

/**
 * Kysely hooks that announce each query. The logger sees the SQL and timing
 * but not the result; the plugin sees the result, so a successful query is
 * held until the plugin adds its row count. Failed queries never reach the
 * plugin and are announced by the logger.
 */
export function sqlTap(): { log: (event: LogEvent) => void; plugin: KyselyPlugin } {
  const pending = new WeakMap<QueryId, Omit<SqlEvent, 'service'>>()
  return {
    log(event) {
      if (sink === undefined) return
      const traced = sqlEvent(event)
      if (traced === undefined) return
      if (event.level === 'error') emit(traced)
      else pending.set(event.query.queryId, traced)
    },
    plugin: {
      transformQuery: ({ node }) => node,
      transformResult: ({ queryId, result }) => {
        const traced = pending.get(queryId)
        if (traced !== undefined) {
          pending.delete(queryId)
          const rows =
            result.numAffectedRows === undefined
              ? result.rows.length
              : Number(result.numAffectedRows)
          emit({ ...traced, rows })
        }
        return Promise.resolve(result)
      },
    },
  }
}

/** Fits an event into one NOTIFY payload, dropping detail if it must. */
export function encodeEvent(event: TraceEvent): string {
  const payload = JSON.stringify(event)
  if (Buffer.byteLength(payload) <= MAX_PAYLOAD_BYTES || event.kind !== 'sql') return payload
  return JSON.stringify({ ...event, sql: shorten(event.sql, 500), params: [] })
}

const MAX_QUEUED = 1000

/**
 * Publishes events through `pool` one at a time, so they arrive in the order
 * they happened. The NOTIFY goes through pg directly, not Kysely, so it is not
 * itself traced. Past {@link MAX_QUEUED} waiting events, new ones are dropped.
 */
export function notifyPublisher(pool: pg.Pool): (event: TraceEvent) => void {
  let queue: Promise<unknown> = Promise.resolve()
  let waiting = 0
  return (event) => {
    if (waiting >= MAX_QUEUED) return
    waiting += 1
    const payload = encodeEvent(event)
    queue = queue
      .then(() => pool.query('select pg_notify($1, $2)', [TRACE_CHANNEL, payload]))
      .catch(() => {
        // A dropped debug event must never affect the service.
      })
      .finally(() => {
        waiting -= 1
      })
  }
}

/** Options for {@link createDb}. */
export interface CreateDbOptions {
  /** Trace everything this process does under this service name. */
  queryTap?: string
}

/** `{ queryTap: service }` when DEBUG_QUERY_TAP=1, otherwise no tracing. */
export function queryTapOptions(
  service: string,
  env: NodeJS.ProcessEnv = process.env,
): CreateDbOptions {
  return env['DEBUG_QUERY_TAP'] === '1' ? { queryTap: service } : {}
}

/**
 * Subscribes to trace events on a dedicated connection. Returns a function
 * that unsubscribes and closes it. `onError` hears about a lost connection,
 * after which nothing more arrives; the caller decides whether to listen again.
 */
export async function listenToTrace(
  connectionString: string,
  onEvent: (event: TraceEvent) => void,
  onError: (error: Error) => void = () => {},
): Promise<() => Promise<void>> {
  const client = new pg.Client({ connectionString })
  client.on('error', onError)
  client.on('notification', (message) => {
    if (message.channel !== TRACE_CHANNEL || message.payload === undefined) return
    try {
      onEvent(JSON.parse(message.payload) as TraceEvent)
    } catch {
      // Ignore payloads that are not ours.
    }
  })
  await client.connect()
  await client.query(`listen ${TRACE_CHANNEL}`)
  return () => client.end()
}
