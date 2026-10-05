import request from 'supertest'
import { describe, expect, it } from 'vitest'

import { createDb } from '@openreel/db'

import { createApp, SERVICE_NAME } from '../src/app.ts'

describe('feedgen GET /health', () => {
  it('returns 200 identifying itself as feedgen', async () => {
    const res = await request(
      createApp({ db: createDb('postgres://nobody:nothing@203.0.113.1:1/none') }),
    ).get('/health')

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: 'ok', service: SERVICE_NAME })
  })
})
