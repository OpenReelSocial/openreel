import request from 'supertest'
import { describe, expect, it } from 'vitest'

import { createDb } from '@openreel/db'
import { ids, lexicons, type SocialOpenreelFeedDescribeFeedGenerator } from '@openreel/lexicons'

import { createApp } from '../src/app.ts'
import { loadFeeds, parseFeeds } from '../src/config.ts'

const db = createDb('postgres://nobody:nothing@203.0.113.1:1/none')

function feedsFile(ranking: unknown) {
  return {
    feeds: [{ id: 'trending', displayName: 'Trending', rankingCriteria: 'heuristic', ranking }],
  }
}

describe('feeds file', () => {
  it('ships a valid default with Latest first', () => {
    const feeds = loadFeeds()
    expect(feeds.map((f) => f.id)).toEqual(['recent', 'popular'])
  })

  it('accepts a weighted feed ranked by likes', () => {
    const [feed] = parseFeeds(
      feedsFile({ type: 'weighted', weights: [{ signal: 'likes', weight: 1 }] }),
    )
    expect(feed?.ranking).toEqual({ type: 'weighted', weights: [{ signal: 'likes', weight: 1 }] })
  })

  it('accepts a weighted feed mixing views and recency', () => {
    const [feed] = parseFeeds(
      feedsFile({
        type: 'weighted',
        weights: [
          { signal: 'views', weight: 0.7 },
          { signal: 'recency', weight: 0.3, halfLifeHours: 24 },
        ],
      }),
    )
    expect(feed?.ranking).toEqual({
      type: 'weighted',
      weights: [
        { signal: 'views', weight: 0.7 },
        { signal: 'recency', weight: 0.3, halfLifeHours: 24 },
      ],
    })
  })

  it.each([
    ['an unknown ranking type', { type: 'magic' }, 'ranking.type'],
    [
      'an unknown signal',
      { type: 'weighted', weights: [{ signal: 'shares', weight: 1 }] },
      'signal',
    ],
    [
      'weights that do not sum to 1',
      { type: 'weighted', weights: [{ signal: 'views', weight: 0.5 }] },
      'sum to 1',
    ],
    [
      'recency without a half-life',
      { type: 'weighted', weights: [{ signal: 'recency', weight: 1 }] },
      'halfLifeHours',
    ],
  ])('rejects %s', (_name, ranking, message) => {
    expect(() => parseFeeds(feedsFile(ranking))).toThrow(message)
  })

  it('rejects duplicate feed IDs', () => {
    const feed = feedsFile({ type: 'chronological' }).feeds[0]
    expect(() => parseFeeds({ feeds: [feed, feed] })).toThrow('duplicate')
  })
})

describe('GET describeFeedGenerator', () => {
  it('lists every configured feed with its weights in basis points', async () => {
    const res = await request(
      createApp({ db, feeds: loadFeeds(), publisher: 'openreel.social' }),
    ).get(`/xrpc/${ids.SocialOpenreelFeedDescribeFeedGenerator}`)

    expect(res.status).toBe(200)
    expect(() =>
      lexicons.assertValidXrpcOutput(ids.SocialOpenreelFeedDescribeFeedGenerator, res.body),
    ).not.toThrow()
    const body = res.body as SocialOpenreelFeedDescribeFeedGenerator.OutputSchema
    expect(body.feeds).toEqual([
      expect.objectContaining({
        uri: 'at://openreel.social/social.openreel.feed.generator/recent',
        displayName: 'Latest',
        rankingCriteria: 'chronological',
      }),
      expect.objectContaining({
        uri: 'at://openreel.social/social.openreel.feed.generator/popular',
        displayName: 'Popular',
        rankingCriteria: 'heuristic',
        weights: [{ signal: 'likes', weightBps: 10_000 }],
      }),
    ])
    expect(body.feeds[0]).not.toHaveProperty('weights')
  })
})
