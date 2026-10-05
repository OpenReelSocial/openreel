import { createDb } from '@openreel/db'
import request from 'supertest'
import { describe, expect, it } from 'vitest'

import { createApp, SERVICE_NAME } from '../src/app.ts'

describe('appview GET /health', () => {
  it('returns 200 identifying itself as appview', async () => {
    const app = createApp({
      // Never connects: /health does not query.
      db: createDb('postgres://nobody:nothing@203.0.113.1:1/none'),
      skeleton: { getFeedSkeleton: () => Promise.resolve({ feed: [] }) },
      defaultFeedUri: 'at://openreel.social/social.openreel.feed.generator/recent',
      mediaPublicUrl: 'https://media.test',
    })
    const res = await request(app).get('/health')

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: 'ok', service: SERVICE_NAME })
  })
})
