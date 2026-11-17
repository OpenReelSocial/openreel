import { traceStep } from '@openreel/db'
import {
  ids,
  lexicons,
  type SocialOpenreelFeedDefs,
  type SocialOpenreelFeedGetFeedSkeleton,
} from '@openreel/lexicons'

import { PublicFetchError, type PublicJsonFetch } from './public-http.ts'
import { SkeletonError, type SkeletonSource } from './skeleton.ts'

/** The authority of a feed URI (`at://<authority>/…`), lower-cased. */
export function feedAuthority(feedUri: string): string | undefined {
  const match = /^at:\/\/([^/?#]+)\//.exec(feedUri)
  return match?.[1]?.toLowerCase()
}

// A dotted DNS name in AT Protocol handle syntax: at least two labels, a
// non-numeric TLD (so IPv4 literals never match), no port.
const HOSTNAME =
  /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/
// Names that only mean something on a local network.
const LOCAL_SUFFIXES = ['.local', '.localhost', '.internal', '.arpa', '.home.arpa', '.lan']

/**
 * The host serving an external feed, from its URI's authority: a domain
 * (`at://feeds.example.com/…`) is served at `https://feeds.example.com`, and
 * `did:web:feeds.example.com` likewise. Other DID methods would need the
 * generator record looked up, which is not supported yet.
 */
export function generatorHost(authority: string): string | undefined {
  const name = authority.startsWith('did:web:') ? authority.slice('did:web:'.length) : authority
  if (name.startsWith('did:') || !HOSTNAME.test(name)) return undefined
  if (name === 'localhost' || LOCAL_SUFFIXES.some((suffix) => name.endsWith(suffix))) {
    return undefined
  }
  return name
}

export interface RoutingOptions {
  /**
   * Authorities our own feed generator publishes under. Feeds it describes
   * are added as they are seen, so a publisher that differs from the default
   * feed's is still routed locally.
   */
  localAuthorities: readonly string[]
  /** Fetches feeds from other generators; without it only local feeds play. */
  external?: PublicJsonFetch | undefined
}

/**
 * Sends each `getFeedSkeleton` to the generator that serves the feed: ours
 * for our feeds, the feed URI's own host for anyone else's. Either way the
 * AppView hydrates the skeleton from its own index, so an external generator
 * can only choose and order posts this AppView already indexed and has not
 * taken down; it cannot add content.
 */
export class RoutingSkeletonSource implements SkeletonSource {
  readonly #local: SkeletonSource
  readonly #external: PublicJsonFetch | undefined
  readonly #localAuthorities: Set<string>
  #described: Promise<void> | undefined

  constructor(local: SkeletonSource, options: RoutingOptions) {
    this.#local = local
    this.#external = options.external
    this.#localAuthorities = new Set(options.localAuthorities.map((a) => a.toLowerCase()))
  }

  async describeFeeds(): Promise<SocialOpenreelFeedDefs.GeneratorView[]> {
    const feeds = await this.#local.describeFeeds()
    for (const feed of feeds) {
      const authority = feedAuthority(feed.uri)
      if (authority !== undefined) this.#localAuthorities.add(authority)
    }
    return feeds
  }

  async getFeedSkeleton(
    params: SocialOpenreelFeedGetFeedSkeleton.QueryParams,
  ): Promise<SocialOpenreelFeedGetFeedSkeleton.OutputSchema> {
    const authority = feedAuthority(params.feed)
    if (authority === undefined || (await this.#isLocal(authority))) {
      return this.#local.getFeedSkeleton(params)
    }
    if (this.#external === undefined) {
      throw new SkeletonError(400, 'UnknownFeed', 'this AppView only serves its own feeds')
    }
    const host = generatorHost(authority)
    if (host === undefined) {
      throw new SkeletonError(
        400,
        'UnknownFeed',
        `cannot find the generator for ${authority}: use a domain or did:web`,
      )
    }
    return this.#fetchExternal(this.#external, host, params)
  }

  /** Learns our generator's authorities once, the first time it matters. */
  async #isLocal(authority: string): Promise<boolean> {
    if (this.#localAuthorities.has(authority)) return true
    this.#described ??= this.describeFeeds().then(
      () => undefined,
      () => {
        // Try again on the next request rather than routing our feeds away.
        this.#described = undefined
      },
    )
    await this.#described
    return this.#localAuthorities.has(authority)
  }

  async #fetchExternal(
    fetchJson: PublicJsonFetch,
    host: string,
    params: SocialOpenreelFeedGetFeedSkeleton.QueryParams,
  ): Promise<SocialOpenreelFeedGetFeedSkeleton.OutputSchema> {
    const url = new URL(`https://${host}/xrpc/${ids.SocialOpenreelFeedGetFeedSkeleton}`)
    url.searchParams.set('feed', params.feed)
    if (params.limit !== undefined) url.searchParams.set('limit', String(params.limit))
    if (params.cursor !== undefined) url.searchParams.set('cursor', params.cursor)

    let response
    try {
      response = await traceStep(
        'Fetch feed skeleton from external feed generator',
        { kind: 'call', target: 'external-feedgen', method: 'GET', path: url.pathname },
        async (note) => {
          const res = await fetchJson(url)
          note({ status: res.status })
          return res
        },
      )
    } catch (error) {
      if (error instanceof PublicFetchError && error.reason === 'blocked') {
        throw new SkeletonError(400, 'UnknownFeed', `${host} is not a public feed generator`)
      }
      const message = error instanceof Error ? error.message : String(error)
      throw new SkeletonError(502, 'UpstreamFailure', `${host}: ${message}`)
    }

    const { status, body } = response
    if (status < 200 || status >= 300) {
      const fields = isRecord(body) ? body : {}
      const error = typeof fields['error'] === 'string' ? fields['error'] : undefined
      if (status >= 400 && status < 500 && error !== undefined) {
        const message = typeof fields['message'] === 'string' ? fields['message'] : error
        throw new SkeletonError(400, error, `${host}: ${message}`)
      }
      throw new SkeletonError(502, 'UpstreamFailure', `${host} returned HTTP ${status}`)
    }
    try {
      lexicons.assertValidXrpcOutput(ids.SocialOpenreelFeedGetFeedSkeleton, body)
    } catch (error) {
      throw new SkeletonError(
        502,
        'UpstreamFailure',
        `${host} returned an invalid skeleton: ${(error as Error).message}`,
      )
    }
    const skeleton = body as SocialOpenreelFeedGetFeedSkeleton.OutputSchema
    // A generator that ignores `limit` must not make us hydrate more.
    const limit = params.limit ?? skeleton.feed.length
    return {
      feed: skeleton.feed.slice(0, limit),
      ...(skeleton.cursor === undefined ? {} : { cursor: skeleton.cursor }),
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
