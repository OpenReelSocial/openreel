import { lookup as dnsLookup, type LookupAddress } from 'node:dns'
import { Agent, request } from 'node:https'
import { BlockList, isIP, type LookupFunction } from 'node:net'

/**
 * A GET to a host somebody else chose, such as a third-party feed generator.
 * The AppView runs next to private services (Postgres, feedgen, the PDS), so
 * a request like this must not be able to reach them: HTTPS only, public
 * addresses only, no redirects, bounded in time and size. This is the
 * "public-only transport" the upstream relay uses for the same reason
 * (ADR-0008).
 */
export type PublicJsonFetch = (url: URL) => Promise<PublicJsonResponse>

export interface PublicJsonResponse {
  status: number
  /** The parsed body, or `undefined` if it was not JSON. */
  body: unknown
}

/** Why a public fetch failed before a usable response arrived. */
export class PublicFetchError extends Error {
  /** `blocked`: the URL or its address is not public. Otherwise the host misbehaved or was unreachable. */
  readonly reason: 'blocked' | 'unreachable'

  constructor(reason: 'blocked' | 'unreachable', message: string) {
    super(message)
    this.reason = reason
  }
}

/**
 * Addresses that are not on the public internet: loopback, private, link-local,
 * shared (CGNAT), multicast, documentation, benchmarking, reserved, and the
 * IPv6 equivalents. IPv4-mapped IPv6 addresses are checked as IPv4.
 */
const NON_PUBLIC = new BlockList()
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  NON_PUBLIC.addSubnet(network, prefix, 'ipv4')
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
] as const) {
  NON_PUBLIC.addSubnet(network, prefix, 'ipv6')
}

const MAPPED_IPV4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i

/** Whether `address` (an IP literal) is a public unicast address. */
export function isPublicAddress(address: string): boolean {
  const mapped = MAPPED_IPV4.exec(address)
  if (mapped?.[1] !== undefined) return isPublicAddress(mapped[1])
  const family = isIP(address)
  if (family === 4) return !NON_PUBLIC.check(address, 'ipv4')
  if (family === 6) return !NON_PUBLIC.check(address, 'ipv6')
  return false
}

type Resolve = (
  hostname: string,
  callback: (error: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void,
) => void

const systemResolve: Resolve = (hostname, callback) => {
  dnsLookup(hostname, { all: true, verbatim: true }, callback)
}

/**
 * A `lookup` for sockets that refuses hosts resolving to any non-public
 * address. The socket connects to the address checked here, so a DNS answer
 * that changes between check and connect (rebinding) cannot slip through.
 */
export function publicOnlyLookup(resolve: Resolve = systemResolve): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname, (error, addresses) => {
      if (error) {
        callback(error, '', 4)
        return
      }
      const blocked = addresses.find((a) => !isPublicAddress(a.address))
      if (blocked !== undefined || addresses.length === 0) {
        const refused = new PublicFetchError(
          'blocked',
          `${hostname} does not resolve to a public address`,
        )
        callback(Object.assign(refused, { code: 'ENOTPUBLIC' }), '', 4)
        return
      }
      const wanted =
        options.family === 4 || options.family === 6
          ? addresses.filter((a) => a.family === options.family)
          : addresses
      if (options.all === true) {
        ;(callback as unknown as (e: null, all: LookupAddress[]) => void)(null, wanted)
        return
      }
      const first = wanted[0]
      if (first === undefined) {
        callback(
          Object.assign(new Error(`${hostname} has no IPv${options.family} address`), {
            code: 'ENOTFOUND',
          }),
          '',
          4,
        )
        return
      }
      callback(null, first.address, first.family)
    })
  }
}

export interface PublicFetchOptions {
  timeoutMs?: number
  /** Bodies larger than this are refused. */
  maxBytes?: number
  /** Swaps DNS for tests. */
  resolve?: Resolve
}

/** Builds a {@link PublicJsonFetch}. */
export function createPublicJsonFetch(options: PublicFetchOptions = {}): PublicJsonFetch {
  const timeoutMs = options.timeoutMs ?? 5_000
  const maxBytes = options.maxBytes ?? 1_000_000
  const agent = new Agent({ lookup: publicOnlyLookup(options.resolve), keepAlive: false })

  return (url) =>
    new Promise<PublicJsonResponse>((resolve, reject) => {
      if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
        reject(new PublicFetchError('blocked', 'only plain https URLs are allowed'))
        return
      }
      if (isIP(url.hostname.replace(/^\[|\]$/g, '')) !== 0) {
        reject(new PublicFetchError('blocked', 'IP addresses are not allowed; use a hostname'))
        return
      }
      if (url.port !== '' && url.port !== '443') {
        reject(new PublicFetchError('blocked', 'only the default https port is allowed'))
        return
      }

      const req = request(
        url,
        { method: 'GET', agent, headers: { accept: 'application/json' }, timeout: timeoutMs },
        (res) => {
          const status = res.statusCode ?? 0
          if (status >= 300 && status < 400) {
            res.resume()
            reject(
              new PublicFetchError('unreachable', `refused to follow a redirect (HTTP ${status})`),
            )
            return
          }
          const chunks: Buffer[] = []
          let size = 0
          res.on('data', (chunk: Buffer) => {
            size += chunk.length
            if (size > maxBytes) {
              req.destroy(
                new PublicFetchError('unreachable', `response is larger than ${maxBytes} bytes`),
              )
              return
            }
            chunks.push(chunk)
          })
          res.on('end', () => {
            let body: unknown
            try {
              body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            } catch {
              body = undefined
            }
            resolve({ status, body })
          })
          res.on('error', (error) => {
            reject(toPublicFetchError(error))
          })
        },
      )
      // `timeout` only covers idle sockets; this bounds the whole exchange.
      const deadline = setTimeout(() => {
        req.destroy(new PublicFetchError('unreachable', `no response within ${timeoutMs} ms`))
      }, timeoutMs)
      req.on('close', () => clearTimeout(deadline))
      req.on('timeout', () => {
        req.destroy(new PublicFetchError('unreachable', `no response within ${timeoutMs} ms`))
      })
      req.on('error', (error) => {
        reject(toPublicFetchError(error))
      })
      req.end()
    })
}

function toPublicFetchError(error: unknown): PublicFetchError {
  if (error instanceof PublicFetchError) return error
  const message = error instanceof Error ? error.message : String(error)
  return new PublicFetchError('unreachable', message)
}
