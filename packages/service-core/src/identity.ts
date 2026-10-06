/**
 * What an indexer needs from an account's DID document: where its repository
 * lives and which handle it claims.
 */
export interface AtprotoIdentity {
  did: string
  /** Handle from `alsoKnownAs`, unverified: nothing here checks it resolves back. */
  handle?: string
  /** Base URL of the account's PDS (`#atproto_pds` service endpoint). */
  pds?: string
}

const PLC_DID = /^did:plc:[a-z2-7]{24}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Extracts the handle and PDS endpoint from a DID document, ignoring anything malformed. */
export function parseDidDocument(did: string, doc: unknown): AtprotoIdentity {
  if (!isRecord(doc) || doc['id'] !== did) throw new Error(`DID document does not describe ${did}`)
  const identity: AtprotoIdentity = { did }

  const aka = Array.isArray(doc['alsoKnownAs']) ? doc['alsoKnownAs'] : []
  const handle = aka.find((v): v is string => typeof v === 'string' && v.startsWith('at://'))
  if (handle !== undefined) identity.handle = handle.slice('at://'.length).toLowerCase()

  const services = Array.isArray(doc['service']) ? doc['service'] : []
  const pds = services.find(
    (s): s is Record<string, unknown> =>
      isRecord(s) &&
      (s['id'] === '#atproto_pds' || s['id'] === `${did}#atproto_pds`) &&
      s['type'] === 'AtprotoPersonalDataServer',
  )
  const endpoint = pds?.['serviceEndpoint']
  if (typeof endpoint === 'string') {
    const url = new URL(endpoint)
    if (url.protocol === 'https:' || url.protocol === 'http:') {
      identity.pds = url.origin
    }
  }
  return identity
}

/**
 * Resolves `did:plc` identities against an operator-configured PLC directory.
 *
 * Only `did:plc` is supported: its documents come from a URL the operator
 * chose, so a plain fetch is safe even when that URL is private (the Compose
 * `plc` service). `did:web` would fetch an attacker-chosen host and needs an
 * SSRF-protected client, which is left for when it is needed.
 */
export class PlcResolver {
  readonly #plcUrl: string
  readonly #timeoutMs: number
  readonly #fetch: typeof fetch

  constructor(plcUrl: string, options: { timeoutMs?: number; fetch?: typeof fetch } = {}) {
    this.#plcUrl = plcUrl.replace(/\/+$/, '')
    this.#timeoutMs = options.timeoutMs ?? 5_000
    this.#fetch = options.fetch ?? fetch
  }

  async resolve(did: string): Promise<AtprotoIdentity> {
    if (!PLC_DID.test(did)) throw new Error(`unsupported DID method: ${did}`)
    const res = await this.#fetch(`${this.#plcUrl}/${did}`, {
      signal: AbortSignal.timeout(this.#timeoutMs),
    })
    if (!res.ok) throw new Error(`PLC lookup for ${did} failed: HTTP ${res.status}`)
    return parseDidDocument(did, await res.json())
  }
}
