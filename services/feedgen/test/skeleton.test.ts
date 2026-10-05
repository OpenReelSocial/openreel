import { createDb } from '@openreel/db'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'

import { createApp } from '../src/app.ts'
import { decodeCursor, encodeCursor, InvalidCursorError, type Feed } from '../src/feeds.ts'

const route = '/xrpc/social.openreel.feed.getFeedSkeleton'
const feedUri = 'at://openreel.social/social.openreel.feed.generator/recent'
const uri = 'at://did:plc:ri7muaelw3trwgd2eda7tuf2/social.openreel.video.post/3abc'
const db = createDb('postgres://nobody:nothing@203.0.113.1:1/none')

function appWith(page: Feed['page']) {
  return createApp({ db, feeds: { recent: { page } } })
}

describe('cursor', () => {
  it('round-trips', () => {
    const sortAt = new Date('2026-10-01T12:00:00.123Z')
    expect(decodeCursor(encodeCursor(sortAt, uri))).toEqual({ sortAt, uri })
  })

  it.each(['', 'abc', '::at://x', '123::https://x', '1.5::at://x'])('rejects %j', (cursor) => {
    expect(() => decodeCursor(cursor)).toThrow(InvalidCursorError)
  })
})

describe('GET getFeedSkeleton', () => {
  it('serves a known feed with default paging', async () => {
    const page = vi.fn(() => Promise.resolve({ feed: [{ post: uri }], cursor: 'next' }))
    const res = await request(appWith(page)).get(route).query({ feed: feedUri })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ feed: [{ post: uri }], cursor: 'next' })
    expect(page).toHaveBeenCalledWith(db, 30, undefined)
  })

  it('passes limit and cursor to the feed', async () => {
    const page = vi.fn(() => Promise.resolve({ feed: [] }))
    await request(appWith(page)).get(route).query({ feed: feedUri, limit: '2', cursor: 'c' })

    expect(page).toHaveBeenCalledWith(db, 2, 'c')
  })

  it.each([
    ['another collection', 'at://openreel.social/app.bsky.feed.generator/recent'],
    ['an unknown rkey', 'at://openreel.social/social.openreel.feed.generator/trending'],
    ['an inherited property name', 'at://openreel.social/social.openreel.feed.generator/toString'],
  ])('reports UnknownFeed for %s', async (_name, feed) => {
    const res = await request(appWith(vi.fn())).get(route).query({ feed })

    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ error: 'UnknownFeed' })
  })

  it.each([
    ['a missing feed', {}],
    ['a limit above 100', { feed: feedUri, limit: '500' }],
  ])('rejects %s', async (_name, query) => {
    const res = await request(appWith(vi.fn())).get(route).query(query)

    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ error: 'InvalidRequest' })
  })

  it('reports a bad cursor as InvalidRequest', async () => {
    const page = vi.fn(() => Promise.reject(new InvalidCursorError('malformed cursor')))
    const res = await request(appWith(page)).get(route).query({ feed: feedUri, cursor: 'x' })

    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: 'InvalidRequest', message: 'malformed cursor' })
  })
})
