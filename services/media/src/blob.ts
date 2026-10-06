import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import { safeFetchWrap } from '@atproto-labs/fetch-node'
import { CID } from 'multiformats/cid'
import { sha256 } from 'multiformats/hashes/sha2'

export class BlobError extends Error {}

export interface BlobFetcherOptions {
  aliases: Map<string, string>
  maxBytes: number
  timeoutMs?: number
}

/**
 * Downloads blobs from an author's PDS (`com.atproto.sync.getBlob`) and checks
 * the bytes hash to the CID the record committed to, so a PDS cannot swap the
 * video after the fact.
 *
 * The PDS URL comes from the author's DID document, which the author controls,
 * so requests go through an SSRF-protected fetch unless the origin is one of
 * the operator's aliases.
 */
export class BlobFetcher {
  readonly #aliases: Map<string, string>
  readonly #maxBytes: number
  readonly #safeFetch: typeof fetch
  readonly #timeoutMs: number

  constructor(options: BlobFetcherOptions) {
    this.#aliases = options.aliases
    this.#maxBytes = options.maxBytes
    this.#timeoutMs = options.timeoutMs ?? 120_000
    this.#safeFetch = safeFetchWrap({
      responseMaxSize: options.maxBytes,
      timeout: this.#timeoutMs,
    })
  }

  async download(pds: string, did: string, cid: string, dest: string): Promise<void> {
    const expected = CID.parse(cid)
    if (expected.multihash.code !== sha256.code) {
      throw new BlobError(`unsupported blob hash in ${cid}`)
    }

    const origin = new URL(pds).origin
    const alias = this.#aliases.get(origin)
    const url = new URL('/xrpc/com.atproto.sync.getBlob', alias ?? origin)
    url.searchParams.set('did', did)
    url.searchParams.set('cid', cid)

    const res =
      alias === undefined
        ? await this.#safeFetch(url, { redirect: 'follow' })
        : await fetch(url, { signal: AbortSignal.timeout(this.#timeoutMs) })
    if (!res.ok || res.body === null) {
      throw new BlobError(`getBlob ${cid} from ${origin} failed: HTTP ${res.status}`)
    }

    const hash = createHash('sha256')
    let size = 0
    const maxBytes = this.#maxBytes
    const meter = new Transform({
      transform(chunk: Buffer, _enc, done) {
        size += chunk.length
        if (size > maxBytes) {
          done(new BlobError(`blob ${cid} exceeds ${maxBytes} bytes`))
          return
        }
        hash.update(chunk)
        done(null, chunk)
      },
    })
    await pipeline(Readable.fromWeb(res.body as never), meter, createWriteStream(dest))

    const digest = hash.digest()
    if (!Buffer.from(expected.multihash.digest).equals(digest)) {
      throw new BlobError(`blob ${cid} from ${origin} does not match its CID`)
    }
  }
}
