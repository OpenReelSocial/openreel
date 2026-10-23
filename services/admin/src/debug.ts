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

export type DebugMessage = { type: 'trace'; trace: Trace }

interface OpenTrace {
  events: TraceEvent[]
  timer?: NodeJS.Timeout
}

/**
 * Assembles trace events into traces and fans them out to every open debug
 * page. Nothing is kept: a page sees only what finishes after it connects.
 *
 * Services announce a trace's root (the request, firehose event, or job) when
 * it finishes, after everything it did. Events from different services can
 * still arrive slightly out of order, so a trace is sent a short grace period
 * after its root arrives.
 */
export class TraceFeed {
  static readonly MAX_OPEN = 500

  readonly #open = new Map<string, OpenTrace>()
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
    // Work outside any trace, such as queue polling, is not shown.
    if (event.trace === undefined) return
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

    this.#send({ type: 'trace', trace })
  }

  #send(message: DebugMessage): void {
    for (const subscriber of this.#subscribers) subscriber(message)
  }

  /** Streams everything from now on as server-sent events. */
  stream(res: Response): void {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    const send = (message: DebugMessage) => res.write(`data: ${JSON.stringify(message)}\n\n`)
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
