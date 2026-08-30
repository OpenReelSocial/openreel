import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { collectStatus } from '../src/checks.ts'
import { createApp } from '../src/app.ts'
import type { Target } from '../src/targets.ts'
import { resolveTargets } from '../src/targets.ts'

// A real listener gives an honest "up" without mocking fetch.
const { createServer } = await import('node:http')
const stub = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ status: 'ok', version: '1.2.3' }))
})

let upTarget: Target
const downTarget: Target = {
  name: 'offline',
  role: 'Nothing listens here',
  // Port 1 is privileged and unbound, so the connection is refused immediately.
  probe: { kind: 'tcp', host: '127.0.0.1', port: 1 },
}

beforeAll(async () => {
  await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve))
  const address = stub.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  upTarget = {
    name: 'stub',
    role: 'Test double',
    probe: { kind: 'http', url: `http://127.0.0.1:${address.port}/health` },
  }
})

afterAll(() => {
  stub.close()
})

describe('collectStatus', () => {
  it('marks a reachable HTTP target up and surfaces its version', async () => {
    const report = await collectStatus([upTarget])

    expect(report.allUp).toBe(true)
    expect(report.results[0]).toMatchObject({ name: 'stub', status: 'up', detail: 'v1.2.3' })
  })

  it('marks an unreachable target down without failing the whole report', async () => {
    const report = await collectStatus([upTarget, downTarget])

    expect(report.allUp).toBe(false)
    expect(report.results.map((r) => r.status)).toEqual(['up', 'down'])
  })
})

describe('GET /', () => {
  it('renders every target and the healthy banner', async () => {
    const res = await request(createApp([upTarget])).get('/')

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/html')
    expect(res.text).toContain('All services operational')
    expect(res.text).toContain('Test double')
  })

  it('reports how many targets are down', async () => {
    const res = await request(createApp([upTarget, downTarget])).get('/')

    expect(res.text).toContain('1 of 2 services down')
  })

  it('escapes values coming from probed services', async () => {
    const evil: Target = {
      name: '<img src=x onerror=alert(1)>',
      role: 'xss probe',
      probe: { kind: 'tcp', host: '127.0.0.1', port: 1 },
    }
    const res = await request(createApp([evil])).get('/')

    expect(res.text).not.toContain('<img src=x')
    expect(res.text).toContain('&lt;img src=x')
  })
})

describe('GET /api/status', () => {
  it('returns 200 when everything is up', async () => {
    const res = await request(createApp([upTarget])).get('/api/status')

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ allUp: true })
  })

  it('returns 503 when anything is down, so scripts can gate on it', async () => {
    const res = await request(createApp([upTarget, downTarget])).get('/api/status')

    expect(res.status).toBe(503)
  })
})

describe('resolveTargets', () => {
  it('defaults to Compose service names', () => {
    const targets = resolveTargets({})

    expect(targets.map((t) => t.name)).toEqual(['appview', 'feedgen', 'pds', 'postgres', 'redis'])
    expect(targets[0]?.probe).toEqual({ kind: 'http', url: 'http://appview:3001/health' })
  })

  it('honours host overrides', () => {
    const targets = resolveTargets({ APPVIEW_HEALTH_URL: 'http://localhost:9/health' })

    expect(targets[0]?.probe).toEqual({ kind: 'http', url: 'http://localhost:9/health' })
  })
})
