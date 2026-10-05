import type { Database } from '@openreel/db'
import type { Kysely } from 'kysely'
import WebSocket, { type RawData } from 'ws'

import { parseEvent } from './events.ts'
import type { Indexer } from './indexer.ts'

const RECONNECT_DELAY_MS = 1_000
const CURSOR_FLUSH_MS = 1_000
const CURSOR_NAME = 'appview:jetstream'

function decode(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8')
  if (data instanceof ArrayBuffer) return Buffer.from(new Uint8Array(data)).toString('utf8')
  return data.toString('utf8')
}

/**
 * Builds the subscribe URL: only the collections the AppView indexes, resuming
 * from `cursor`. With no saved cursor it starts from the oldest event Jetstream
 * still retains rather than live, so a fresh index picks up existing posts.
 */
export function subscribeUrl(
  base: string,
  collections: string[],
  cursor: number | undefined,
): string {
  const url = new URL(base)
  url.searchParams.delete('wantedCollections')
  for (const collection of collections) url.searchParams.append('wantedCollections', collection)
  url.searchParams.set('cursor', String(cursor ?? 1))
  return url.toString()
}

/**
 * Keeps the AppView subscribed to Jetstream and feeds events to the indexer one
 * at a time, in order. The cursor of the last indexed event is saved every
 * second and used on reconnect, so restarts replay rather than skip.
 */
export class JetstreamSubscription {
  readonly #baseUrl: string
  readonly #collections: string[]
  readonly #db: Kysely<Database>
  readonly #indexer: Indexer
  #socket: WebSocket | undefined
  #stopped = true
  #reconnectTimer: NodeJS.Timeout | undefined
  #flushTimer: NodeJS.Timeout | undefined
  #queue: Promise<void> = Promise.resolve()
  #cursor: number | undefined
  #savedCursor: number | undefined

  constructor(baseUrl: string, collections: string[], db: Kysely<Database>, indexer: Indexer) {
    this.#baseUrl = baseUrl
    this.#collections = collections
    this.#db = db
    this.#indexer = indexer
  }

  async start(): Promise<void> {
    if (!this.#stopped) return
    this.#stopped = false
    const row = await this.#db
      .selectFrom('sync_cursor')
      .select('cursor')
      .where('name', '=', CURSOR_NAME)
      .executeTakeFirst()
    this.#cursor = row?.cursor
    this.#savedCursor = row?.cursor
    this.#flushTimer = setInterval(() => void this.#flush(), CURSOR_FLUSH_MS)
    this.#connect()
  }

  async stop(): Promise<void> {
    this.#stopped = true
    if (this.#reconnectTimer !== undefined) clearTimeout(this.#reconnectTimer)
    clearInterval(this.#flushTimer)
    this.#socket?.close()
    await this.#queue
    await this.#flush()
  }

  #connect(): void {
    if (this.#stopped) return
    const url = subscribeUrl(this.#baseUrl, this.#collections, this.#cursor)
    const socket = new WebSocket(url)
    this.#socket = socket

    socket.on('open', () => console.log(`[appview] indexing from ${url}`))
    socket.on('message', (data: RawData) => {
      const event = parseEvent(decode(data))
      if (event === undefined) return
      this.#queue = this.#queue.then(async () => {
        try {
          await this.#indexer.handle(event)
        } catch (error) {
          // Skip rather than wedge the stream on one bad event; it is logged
          // and a replay (or the next edit of the record) can fix it.
          console.error(`[appview] failed to index event from ${event.did}:`, error)
        }
        this.#cursor = event.time_us
      })
    })
    socket.on('error', (error) => console.error(`[appview] Jetstream error: ${error.message}`))
    socket.on('close', () => {
      if (this.#socket === socket) this.#socket = undefined
      if (!this.#stopped) {
        this.#reconnectTimer = setTimeout(() => {
          // Resume from what has actually been indexed, not merely received.
          void this.#queue.then(() => this.#connect())
        }, RECONNECT_DELAY_MS)
      }
    })
  }

  async #flush(): Promise<void> {
    const cursor = this.#cursor
    if (cursor === undefined || cursor === this.#savedCursor) return
    try {
      await this.#db
        .insertInto('sync_cursor')
        .values({ name: CURSOR_NAME, cursor })
        .onConflict((oc) => oc.column('name').doUpdateSet({ cursor, updated_at: new Date() }))
        .execute()
      this.#savedCursor = cursor
    } catch (error) {
      console.error('[appview] failed to save Jetstream cursor:', error)
    }
  }
}
