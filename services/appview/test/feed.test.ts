import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'

import { createApp } from '../src/app.ts'
import { SkeletonError } from '../src/skeleton.ts'
import { deps, feedUri } from './fixtures.ts'

const route = '/xrpc/social.openreel.feed.getFeed'

describe('GET getFeed', () => {
  it('asks the generator for the default feed with default paging', async () => {
    const getFeedSkeleton = vi.fn(() => Promise.resolve({ feed: [], cursor: 'next' }))
    const res = await request(createApp(deps({ getFeedSkeleton }))).get(route)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ feed: [], cursor: 'next' })
    expect(getFeedSkeleton).toHaveBeenCalledWith({ feed: feedUri, limit: 30 })
  })

  it('passes feed, limit, and cursor through', async () => {
    const getFeedSkeleton = vi.fn(() => Promise.resolve({ feed: [] }))
    const other = 'at://did:plc:ri7muaelw3trwgd2eda7tuf2/social.openreel.feed.generator/x'
    await request(createApp(deps({ getFeedSkeleton })))
      .get(route)
      .query({ feed: other, limit: '5', cursor: 'c1' })

    expect(getFeedSkeleton).toHaveBeenCalledWith({ feed: other, limit: 5, cursor: 'c1' })
  })

  it.each([
    ['limit above 100', { limit: '101' }],
    ['non-numeric limit', { limit: 'ten' }],
    ['feed that is not an AT-URI', { feed: 'recent' }],
  ])('rejects %s', async (_name, query) => {
    const getFeedSkeleton = vi.fn()
    const res = await request(createApp(deps({ getFeedSkeleton })))
      .get(route)
      .query(query)

    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ error: 'InvalidRequest' })
    expect(getFeedSkeleton).not.toHaveBeenCalled()
  })

  it('relays generator errors', async () => {
    const getFeedSkeleton = vi.fn(() =>
      Promise.reject(new SkeletonError(400, 'UnknownFeed', 'no such feed')),
    )
    const res = await request(createApp(deps({ getFeedSkeleton }))).get(route)

    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: 'UnknownFeed', message: 'no such feed' })
  })
})
