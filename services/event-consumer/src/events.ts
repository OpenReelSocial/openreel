export interface CommitEvent {
  readonly did: string
  readonly time_us: number
  readonly kind: 'commit'
  readonly commit: {
    readonly rev: string
    readonly operation: 'create' | 'update' | 'delete'
    readonly collection: string
    readonly rkey: string
    readonly record?: Record<string, unknown>
    readonly cid?: string
  }
}

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'

export interface ConsumerStatus {
  connection: ConnectionStatus
  observedEvents: number
  bufferedEvents: number
  lastEventAt?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Parse only commit events needed by backend indexers; markers remain Jetstream's responsibility. */
export function parseCommitEvent(payload: string): CommitEvent | undefined {
  let value: unknown
  try {
    value = JSON.parse(payload)
  } catch {
    return undefined
  }

  if (!isRecord(value) || value['kind'] !== 'commit' || !isRecord(value['commit'])) return undefined
  const commit = value['commit']
  const operation = commit['operation']
  if (
    typeof value['did'] !== 'string' ||
    typeof value['time_us'] !== 'number' ||
    typeof commit['rev'] !== 'string' ||
    (operation !== 'create' && operation !== 'update' && operation !== 'delete') ||
    typeof commit['collection'] !== 'string' ||
    typeof commit['rkey'] !== 'string'
  ) {
    return undefined
  }

  return value as unknown as CommitEvent
}

export class EventStore {
  readonly #capacity: number
  readonly #events: CommitEvent[] = []
  #observedEvents = 0
  #connection: ConnectionStatus = 'connecting'
  #lastEventAt: string | undefined

  constructor(capacity = 100) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error('EVENT_BUFFER_SIZE must be a positive integer')
    }
    this.#capacity = capacity
  }

  setConnection(connection: ConnectionStatus): void {
    this.#connection = connection
  }

  add(event: CommitEvent): void {
    this.#events.push(event)
    if (this.#events.length > this.#capacity) this.#events.shift()
    this.#observedEvents += 1
    this.#lastEventAt = new Date(Math.floor(event.time_us / 1000)).toISOString()
  }

  find(filters: { did?: string; collection?: string; rkey?: string }): CommitEvent[] {
    return this.#events.filter(
      (event) =>
        (filters.did === undefined || event.did === filters.did) &&
        (filters.collection === undefined || event.commit.collection === filters.collection) &&
        (filters.rkey === undefined || event.commit.rkey === filters.rkey),
    )
  }

  status(): ConsumerStatus {
    return {
      connection: this.#connection,
      observedEvents: this.#observedEvents,
      bufferedEvents: this.#events.length,
      ...(this.#lastEventAt === undefined ? {} : { lastEventAt: this.#lastEventAt }),
    }
  }
}
