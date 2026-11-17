import { createDb } from '@openreel/db'
import { ids, type SocialOpenreelFeedGetFeedSkeleton } from '@openreel/lexicons'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'

import { createApp } from '../src/app.ts'
import { feedAuthority, generatorHost, RoutingSkeletonSource } from '../src/feed-routing.ts'
import {
  createPublicJsonFetch,
  isPublicAddress,
  PublicFetchError,
  publicOnlyLookup,
  type PublicJsonFetch,
} from '../src/public-http.ts'
import type { SkeletonSource } from '../src/skeleton.ts'

const OURS = 'at://openreel.social/social.openreel.feed.generator'
const THEIRS = 'at://feeds.example.com/social.openreel.feed.generator/cats'
const POST = 'at://did:plc:alice000000000000000000000/social.openreel.video.post/3kabc'

function localSource(feeds: string[] = [`${OURS}/recent`]) {
  const getFeedSkeleton = vi.fn(() => Promise.resolve({ feed: [{ post: POST }] }))
  const describeFeeds = vi.fn(() =>
    Promise.resolve(
      feeds.map((uri) => ({ uri, displayName: 'Feed', rankingCriteria: 'chronological' })),
    ),
  )
  const source: SkeletonSource = { getFeedSkeleton, describeFeeds }
  return { source, getFeedSkeleton, describeFeeds }
}

function externalReturning(
  status: number,
  body: unknown,
): PublicJsonFetch & ReturnType<typeof vi.fn> {
  return vi.fn(() => Promise.resolve({ status, body }))
}

describe('feedAuthority', () => {
  it('reads and lower-cases the authority', () => {
    expect(feedAuthority('at://Feeds.Example.com/social.openreel.feed.generator/x')).toBe(
      'feeds.example.com',
    )
    expect(feedAuthority('not a uri')).toBeUndefined()
  })
})

describe('generatorHost', () => {
  it('serves a domain or did:web authority from that host', () => {
    expect(generatorHost('feeds.example.com')).toBe('feeds.example.com')
    expect(generatorHost('did:web:feeds.example.com')).toBe('feeds.example.com')
  })

  it('refuses authorities it cannot or must not resolve to a public host', () => {
    for (const authority of [
      'did:plc:alice000000000000000000000',
      'localhost',
      'feedgen',
      '127.0.0.1',
      '169.254.169.254',
      'printer.local',
      'db.internal',
      'did:web:localhost%3A3002',
      'feeds.example.com:8443',
      '-bad.example.com',
    ]) {
      expect(generatorHost(authority), authority).toBeUndefined()
    }
  })
})

describe('isPublicAddress', () => {
  it('accepts public unicast addresses', () => {
    for (const address of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) {
      expect(isPublicAddress(address), address).toBe(true)
    }
  })

  it('refuses loopback, private, link-local, metadata and mapped addresses', () => {
    for (const address of [
      '127.0.0.1',
      '10.1.2.3',
      '172.20.0.5',
      '192.168.1.1',
      '100.64.0.1',
      '169.254.169.254',
      '0.0.0.0',
      '224.0.0.1',
      '::1',
      '::',
      'fd00::1',
      'fe80::1',
      '::ffff:127.0.0.1',
      '::ffff:10.0.0.1',
      'not-an-ip',
    ]) {
      expect(isPublicAddress(address), address).toBe(false)
    }
  })
})

describe('publicOnlyLookup', () => {
  const resolvingTo =
    (...addresses: string[]) =>
    (_host: string, cb: (e: null, a: { address: string; family: number }[]) => void) => {
      cb(
        null,
        addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })),
      )
    }

  it('returns every public address when asked for all', async () => {
    const lookup = publicOnlyLookup(resolvingTo('93.184.215.14', '2606:2800:21f:cb07::1'))
    const result = await new Promise((resolve, reject) => {
      lookup('feeds.example.com', { all: true }, (error, addresses) => {
        if (error) reject(error)
        else resolve(addresses)
      })
    })
    expect(result).toHaveLength(2)
  })

  it('refuses a host if any of its addresses is not public', async () => {
    const lookup = publicOnlyLookup(resolvingTo('93.184.215.14', '10.0.0.7'))
    const error = await new Promise((resolve) => {
      lookup('feeds.example.com', {}, (e) => resolve(e))
    })
    expect(error).toBeInstanceOf(PublicFetchError)
  })
})

describe('createPublicJsonFetch', () => {
  it('refuses URLs that are not plain https on the default port', async () => {
    const fetchJson = createPublicJsonFetch()
    for (const url of [
      'http://feeds.example.com/x',
      'https://127.0.0.1/x',
      'https://[::1]/x',
      'https://feeds.example.com:8443/x',
      'https://user:pw@feeds.example.com/x',
    ]) {
      await expect(fetchJson(new URL(url)), url).rejects.toMatchObject({ reason: 'blocked' })
    }
  })

  it('never connects to a name that resolves to a private address', async () => {
    const fetchJson = createPublicJsonFetch({
      resolve: (_host, cb) => {
        cb(null, [{ address: '127.0.0.1', family: 4 }])
      },
    })
    await expect(fetchJson(new URL('https://rebind.example.com/x'))).rejects.toMatchObject({
      reason: 'blocked',
    })
  })
})

describe('RoutingSkeletonSource', () => {
  it('sends our feeds to our generator', async () => {
    const local = localSource()
    const external = externalReturning(200, { feed: [] })
    const source = new RoutingSkeletonSource(local.source, {
      localAuthorities: ['openreel.social'],
      external,
    })

    await source.getFeedSkeleton({ feed: `${OURS}/recent`, limit: 10 })

    expect(local.getFeedSkeleton).toHaveBeenCalledOnce()
    expect(external).not.toHaveBeenCalled()
  })

  it("learns our generator's other publishers before routing anything away", async () => {
    const local = localSource(['at://dev.openreel.social/social.openreel.feed.generator/recent'])
    const external = externalReturning(200, { feed: [] })
    const source = new RoutingSkeletonSource(local.source, {
      localAuthorities: ['openreel.social'],
      external,
    })

    await source.getFeedSkeleton({
      feed: 'at://dev.openreel.social/social.openreel.feed.generator/recent',
    })

    expect(local.describeFeeds).toHaveBeenCalledOnce()
    expect(local.getFeedSkeleton).toHaveBeenCalledOnce()
    expect(external).not.toHaveBeenCalled()
  })

  it("fetches another generator's feed from its own host", async () => {
    const external = externalReturning(200, { feed: [{ post: POST }], cursor: 'next' })
    const source = new RoutingSkeletonSource(localSource().source, {
      localAuthorities: ['openreel.social'],
      external,
    })

    const skeleton = await source.getFeedSkeleton({ feed: THEIRS, limit: 5, cursor: 'c1' })

    expect(skeleton).toEqual({ feed: [{ post: POST }], cursor: 'next' })
    const url = (external.mock.calls[0] as [URL])[0]
    expect(url.origin).toBe('https://feeds.example.com')
    expect(url.pathname).toBe(`/xrpc/${ids.SocialOpenreelFeedGetFeedSkeleton}`)
    expect(url.searchParams.get('feed')).toBe(THEIRS)
    expect(url.searchParams.get('limit')).toBe('5')
    expect(url.searchParams.get('cursor')).toBe('c1')
  })

  it('caps a page at the requested limit', async () => {
    const feed = Array.from({ length: 50 }, (_, i) => ({ post: `${POST}${i}` }))
    const source = new RoutingSkeletonSource(localSource().source, {
      localAuthorities: ['openreel.social'],
      external: externalReturning(200, { feed }),
    })

    const skeleton = await source.getFeedSkeleton({ feed: THEIRS, limit: 3 })

    expect(skeleton.feed).toHaveLength(3)
  })

  it('reports a malformed skeleton as an upstream failure', async () => {
    const source = new RoutingSkeletonSource(localSource().source, {
      localAuthorities: ['openreel.social'],
      external: externalReturning(200, { feed: [{ post: 'javascript:alert(1)' }] }),
    })

    await expect(source.getFeedSkeleton({ feed: THEIRS })).rejects.toMatchObject({
      status: 502,
      error: 'UpstreamFailure',
    })
  })

  it("relays the generator's own client errors", async () => {
    const source = new RoutingSkeletonSource(localSource().source, {
      localAuthorities: ['openreel.social'],
      external: externalReturning(400, { error: 'UnknownFeed', message: 'no such feed' }),
    })

    await expect(source.getFeedSkeleton({ feed: THEIRS })).rejects.toMatchObject({
      status: 400,
      error: 'UnknownFeed',
    })
  })

  it('reports a host that is not public as an unknown feed', async () => {
    const source = new RoutingSkeletonSource(localSource().source, {
      localAuthorities: ['openreel.social'],
      external: () => Promise.reject(new PublicFetchError('blocked', 'private')),
    })

    await expect(source.getFeedSkeleton({ feed: THEIRS })).rejects.toMatchObject({
      status: 400,
      error: 'UnknownFeed',
    })
  })

  it('refuses external feeds when they are turned off', async () => {
    const source = new RoutingSkeletonSource(localSource().source, {
      localAuthorities: ['openreel.social'],
    })

    await expect(source.getFeedSkeleton({ feed: THEIRS })).rejects.toMatchObject({
      status: 400,
      error: 'UnknownFeed',
    })
  })

  it('refuses authorities with no resolvable host', async () => {
    const external = externalReturning(200, { feed: [] })
    const source = new RoutingSkeletonSource(localSource().source, {
      localAuthorities: ['openreel.social'],
      external,
    })

    await expect(
      source.getFeedSkeleton({
        feed: 'at://did:plc:alice000000000000000000000/social.openreel.feed.generator/x',
      }),
    ).rejects.toMatchObject({ status: 400, error: 'UnknownFeed' })
    expect(external).not.toHaveBeenCalled()
  })
})

describe('appview GET getFeed with an external feed', () => {
  function app(external: PublicJsonFetch) {
    return createApp({
      db: createDb('postgres://nobody:nothing@203.0.113.1:1/none'),
      skeleton: new RoutingSkeletonSource(localSource().source, {
        localAuthorities: ['openreel.social'],
        external,
      }),
      defaultFeedUri: `${OURS}/recent`,
      mediaPublicUrl: 'https://media.test',
    })
  }

  it("serves the generator's page, cursor included", async () => {
    const empty: SocialOpenreelFeedGetFeedSkeleton.OutputSchema = { feed: [], cursor: 'more' }
    const res = await request(app(externalReturning(200, empty)))
      .get(`/xrpc/${ids.SocialOpenreelFeedGetFeed}`)
      .query({ feed: THEIRS })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ feed: [], cursor: 'more' })
  })

  it('reports an unreachable generator as an upstream failure', async () => {
    const res = await request(
      app(() => Promise.reject(new PublicFetchError('unreachable', 'connect ECONNREFUSED'))),
    )
      .get(`/xrpc/${ids.SocialOpenreelFeedGetFeed}`)
      .query({ feed: THEIRS })

    expect(res.status).toBe(502)
    expect(res.body).toMatchObject({ error: 'UpstreamFailure' })
  })
})
