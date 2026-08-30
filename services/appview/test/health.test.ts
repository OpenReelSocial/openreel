import request from 'supertest'
import { describe, expect, it } from 'vitest'

import { createApp, SERVICE_NAME } from '../src/app.ts'

describe('appview GET /health', () => {
  it('returns 200 identifying itself as appview', async () => {
    const res = await request(createApp()).get('/health')

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: 'ok', service: SERVICE_NAME })
  })
})
