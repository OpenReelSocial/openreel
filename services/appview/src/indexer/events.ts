/**
 * The subset of Jetstream's JSON event stream the indexer consumes
 * (https://github.com/bluesky-social/jetstream). Anything else is ignored.
 */
export type JetstreamEvent = CommitEvent | IdentityEvent | AccountEvent

interface BaseEvent {
  did: string
  /** Jetstream's cursor: microseconds since the epoch. */
  time_us: number
}

export interface CommitEvent extends BaseEvent {
  kind: 'commit'
  commit: {
    operation: 'create' | 'update' | 'delete'
    collection: string
    rkey: string
    record?: Record<string, unknown>
    cid?: string
  }
}

export interface IdentityEvent extends BaseEvent {
  kind: 'identity'
  identity: { did: string; handle?: string }
}

export interface AccountEvent extends BaseEvent {
  kind: 'account'
  account: { did: string; active: boolean; status?: string }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseEvent(payload: string): JetstreamEvent | undefined {
  let value: unknown
  try {
    value = JSON.parse(payload)
  } catch {
    return undefined
  }
  if (
    !isRecord(value) ||
    typeof value['did'] !== 'string' ||
    typeof value['time_us'] !== 'number'
  ) {
    return undefined
  }

  switch (value['kind']) {
    case 'commit': {
      const commit = value['commit']
      if (
        !isRecord(commit) ||
        !['create', 'update', 'delete'].includes(commit['operation'] as string) ||
        typeof commit['collection'] !== 'string' ||
        typeof commit['rkey'] !== 'string' ||
        (commit['record'] !== undefined && !isRecord(commit['record'])) ||
        (commit['cid'] !== undefined && typeof commit['cid'] !== 'string')
      ) {
        return undefined
      }
      return value as unknown as CommitEvent
    }
    case 'identity':
      return isRecord(value['identity']) ? (value as unknown as IdentityEvent) : undefined
    case 'account':
      return isRecord(value['account']) && typeof value['account']['active'] === 'boolean'
        ? (value as unknown as AccountEvent)
        : undefined
    default:
      return undefined
  }
}
