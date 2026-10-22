import { createDb } from '@openreel/db'
import { ids, lexicons, type SocialOpenreelFeedGetSuggestedFeeds } from '@openreel/lexicons'
import request from 'supertest'
import { describe, expect, it } from 'vitest'

import { createApp } from '../src/app.ts'
import { SkeletonError, type SkeletonSource } from '../src/skeleton.ts'

const GEN = 'at://openreel.social/social.openreel.feed.generator'

function app(skeleton: SkeletonSource) {
  return createApp({
    db: createDb('postgres://nobody:nothing@203.0.113.1:1/none'),
    skeleton,
    defaultFeedUri: `${GEN}/recent`,
    mediaPublicUrl: 'https://media.test',
  })
}

describe('appview GET getSuggestedFeeds', () => {
  it("relays the generator's feeds with the default feed first", async () => {
    const res = await request(
      app({
        getFeedSkeleton: () => Promise.resolve({ feed: [] }),
        describeFeeds: () =>
          Promise.resolve([
            {
              uri: `${GEN}/most-viewed`,
              displayName: 'Most viewed',
              rankingCriteria: 'heuristic',
              weights: [{ signal: 'views', weightBps: 10_000 }],
            },
            { uri: `${GEN}/recent`, displayName: 'Latest', rankingCriteria: 'chronological' },
          ]),
      }),
    ).get(`/xrpc/${ids.SocialOpenreelFeedGetSuggestedFeeds}`)

    expect(res.status).toBe(200)
    expect(() =>
      lexicons.assertValidXrpcOutput(ids.SocialOpenreelFeedGetSuggestedFeeds, res.body),
    ).not.toThrow()
    const body = res.body as SocialOpenreelFeedGetSuggestedFeeds.OutputSchema
    expect(body.feeds.map((f) => f.uri)).toEqual([`${GEN}/recent`, `${GEN}/most-viewed`])
  })

  it('reports an unreachable generator as an upstream failure', async () => {
    const res = await request(
      app({
        getFeedSkeleton: () => Promise.resolve({ feed: [] }),
        describeFeeds: () => Promise.reject(new SkeletonError(502, 'UpstreamFailure', 'down')),
      }),
    ).get(`/xrpc/${ids.SocialOpenreelFeedGetSuggestedFeeds}`)

    expect(res.status).toBe(502)
    expect(res.body).toMatchObject({ error: 'UpstreamFailure' })
  })
})
