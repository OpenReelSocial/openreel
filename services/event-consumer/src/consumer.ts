import WebSocket, { type RawData } from 'ws'

import { EventStore, parseCommitEvent } from './events.ts'

const RECONNECT_DELAY_MS = 1_000

function decodeMessage(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8')
  if (data instanceof ArrayBuffer) return Buffer.from(new Uint8Array(data)).toString('utf8')
  return data.toString('utf8')
}

export interface EventConsumer {
  start(): void
  stop(): void
}

/** Maintains the development backend's subscription to Jetstream's decoded event stream. */
export class JetstreamConsumer implements EventConsumer {
  readonly #url: string
  readonly #store: EventStore
  #socket: WebSocket | undefined
  #reconnectTimer: NodeJS.Timeout | undefined
  #stopped = true

  constructor(url: string, store: EventStore) {
    this.#url = url
    this.#store = store
  }

  start(): void {
    if (!this.#stopped) return
    this.#stopped = false
    this.#connect()
  }

  stop(): void {
    this.#stopped = true
    if (this.#reconnectTimer !== undefined) clearTimeout(this.#reconnectTimer)
    this.#reconnectTimer = undefined
    this.#socket?.close()
    this.#socket = undefined
    this.#store.setConnection('disconnected')
  }

  #connect(): void {
    if (this.#stopped) return
    this.#store.setConnection('connecting')
    const socket = new WebSocket(this.#url)
    this.#socket = socket

    socket.on('open', () => {
      this.#store.setConnection('connected')
      console.log(`[event-consumer] connected to ${this.#url}`)
    })
    socket.on('message', (data: RawData) => {
      const event = parseCommitEvent(decodeMessage(data))
      if (event === undefined) return
      this.#store.add(event)
      console.log(
        `[event-consumer] ${event.commit.operation} at://${event.did}/${event.commit.collection}/${event.commit.rkey}`,
      )
    })
    socket.on('error', (error) => {
      console.error(`[event-consumer] Jetstream connection error: ${error.message}`)
    })
    socket.on('close', () => {
      if (this.#socket === socket) this.#socket = undefined
      this.#store.setConnection('disconnected')
      if (!this.#stopped) {
        this.#reconnectTimer = setTimeout(() => this.#connect(), RECONNECT_DELAY_MS)
      }
    })
  }
}
