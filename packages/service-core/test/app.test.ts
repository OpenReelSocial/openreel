import request from 'supertest'
import { describe, expect, it } from 'vitest'

import { createServiceApp } from '../src/app.ts'
import type { HealthReport } from '../src/health.ts'

describe('createServiceApp', () => {
  it('serves a health report identifying the service', async () => {
    const res = await request(createServiceApp('example')).get('/health')

    expect(res.status).toBe(200)
    const body = res.body as HealthReport
    expect(body).toMatchObject({ status: 'ok', service: 'example' })
    expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0)
  })

  it('does not advertise the server framework', async () => {
    const res = await request(createServiceApp('example')).get('/health')

    expect(res.headers['x-powered-by']).toBeUndefined()
  })

  it('returns 404 for unknown routes', async () => {
    const res = await request(createServiceApp('example')).get('/nope')

    expect(res.status).toBe(404)
  })
})
