import { isRootEvent, type Database, type TraceEvent } from '@openreel/db'
import type { Response } from 'express'
import { sql, type Kysely } from 'kysely'

/** One thing that happened: a request, a firehose event, or a job, with everything it did. */
export interface Trace {
  id: string
  /** In the order they started. */
  events: TraceEvent[]
  /** The handle of the account the trace is about, when the index knows it. */
  handle?: string
}

/** Repeated work outside any trace, such as polling, counted rather than drawn. */
export interface Background {
  service: string
  label: string
  count: number
}

export type DebugMessage =
  | { type: 'trace'; trace: Trace }
  /** Ends the backlog: traces after this are happening now. */
  | { type: 'ready' }
  | ({ type: 'background' } & Background)

interface OpenTrace {
  events: TraceEvent[]
  timer?: NodeJS.Timeout
}

function backgroundLabel(event: TraceEvent): string {
  if (event.purpose !== undefined) return event.purpose
  if (event.kind === 'sql') return `${event.op} ${event.writes ?? event.reads.join(', ')}`
  return event.kind
}

/**
 * Assembles trace events into traces and fans them out to every open debug
 * page, keeping the most recent so a page opened mid-demo has context.
 *
 * Services announce a trace's root (the request, firehose event, or job) when
 * it finishes, after everything it did. Events from different services can
 * still arrive slightly out of order, so a trace is sent a short grace period
 * after its root arrives.
 */
export class TraceFeed {
  static readonly BACKLOG = 40
  static readonly MAX_OPEN = 500

  readonly #open = new Map<string, OpenTrace>()
  readonly #backlog: Trace[] = []
  readonly #background = new Map<string, Background>()
  readonly #subscribers = new Set<(message: DebugMessage) => void>()
  readonly #handleOf: (did: string) => Promise<string | undefined>
  readonly #graceMs: number

  constructor(
    handleOf: (did: string) => Promise<string | undefined> = () => Promise.resolve(undefined),
    graceMs = 400,
  ) {
    this.#handleOf = handleOf
    this.#graceMs = graceMs
  }

  push(event: TraceEvent): void {
    if (event.trace === undefined) {
      this.#countBackground(event)
      return
    }
    let open = this.#open.get(event.trace)
    if (open === undefined) {
      // A root that never arrives (a crashed request) must not hold memory forever.
      if (this.#open.size >= TraceFeed.MAX_OPEN) this.#drop(this.#open.keys().next().value)
      open = { events: [] }
      this.#open.set(event.trace, open)
    }
    open.events.push(event)
    if (isRootEvent(event) && open.timer === undefined) {
      const id = event.trace
      open.timer = setTimeout(() => void this.#finish(id), this.#graceMs)
    }
  }

  #drop(id: string | undefined): void {
    if (id === undefined) return
    clearTimeout(this.#open.get(id)?.timer)
    this.#open.delete(id)
  }

  async #finish(id: string): Promise<void> {
    const open = this.#open.get(id)
    if (open === undefined) return
    this.#open.delete(id)
    const events = open.events.sort((a, b) => a.at.localeCompare(b.at))
    const root = events.find(isRootEvent)
    const did = root?.kind === 'firehose' || root?.kind === 'job' ? root.did : undefined
    const handle = did === undefined ? undefined : await this.#handleOf(did).catch(() => undefined)
    const trace: Trace = { id, events, ...(handle === undefined ? {} : { handle }) }

    this.#backlog.push(trace)
    if (this.#backlog.length > TraceFeed.BACKLOG) this.#backlog.shift()
    this.#send({ type: 'trace', trace })
  }

  #countBackground(event: TraceEvent): void {
    const label = backgroundLabel(event)
    const key = `${event.service}\u0000${label}`
    const entry = this.#background.get(key) ?? { service: event.service, label, count: 0 }
    entry.count += 1
    this.#background.set(key, entry)
    this.#send({ type: 'background', ...entry })
  }

  #send(message: DebugMessage): void {
    for (const subscriber of this.#subscribers) subscriber(message)
  }

  /**
   * Streams background counts and the backlog, marks the end of the backlog
   * so the page can tell old traces from new, then sends everything new, as
   * server-sent events.
   */
  stream(res: Response): void {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    const send = (message: DebugMessage) => res.write(`data: ${JSON.stringify(message)}\n\n`)
    for (const entry of this.#background.values()) send({ type: 'background', ...entry })
    for (const trace of this.#backlog) send({ type: 'trace', trace })
    send({ type: 'ready' })
    this.#subscribers.add(send)
    // Comments keep proxies from closing an idle stream.
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 15_000)
    res.on('close', () => {
      clearInterval(heartbeat)
      this.#subscribers.delete(send)
    })
  }
}

/** Handles from the index, cached briefly; traces name accounts by DID. */
export function handleLookup(db: Kysely<Database>, ttlMs = 60_000) {
  const cache = new Map<string, { handle: string | undefined; until: number }>()
  return async (did: string): Promise<string | undefined> => {
    const hit = cache.get(did)
    if (hit !== undefined && hit.until > Date.now()) return hit.handle
    const row = await db
      .selectFrom('actor')
      .select('handle')
      .where('did', '=', did)
      .executeTakeFirst()
    const handle = row?.handle ?? undefined
    cache.set(did, { handle, until: Date.now() + ttlMs })
    return handle
  }
}

/** Row counts for the tables the system map draws. */
export async function tableCounts(db: Kysely<Database>) {
  const result = await sql<Record<string, number>>`
    select
      (select count(*) from actor)::int as actor,
      (select count(*) from video_post)::int as video_post,
      (select count(*) from video_like)::int as video_like,
      (select count(*) from watch_event)::int as watch_event,
      (select count(*) from video_post_stats)::int as video_post_stats,
      (select count(*) from video_media)::int as video_media
  `.execute(db)
  return { at: new Date().toISOString(), tables: result.rows[0] ?? {} }
}
