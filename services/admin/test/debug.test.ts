import type { TappedQuery } from '@openreel/db'
import request from 'supertest'
import { describe, expect, it } from 'vitest'

import { createApp } from '../src/app.ts'
import { QueryFeed } from '../src/debug.ts'

const query = (n: number): TappedQuery => ({
  service: 'appview',
  sql: `select ${n}`,
  params: [],
  durationMs: 1,
  at: '2026-10-22T00:00:00.000Z',
})

describe('debug portal', () => {
  it('serves the page, explaining when there is no database', async () => {
    const res = await request(createApp([])).get('/debug')
    expect(res.status).toBe(200)
    expect(res.text).toContain('OpenReel live pipeline')
    expect(res.text).toContain('no DATABASE_URL')
  })

  it('reports the snapshot as not configured without a database', async () => {
    const res = await request(createApp([])).get('/debug/api/snapshot')
    expect(res.status).toBe(503)
  })

  it('keeps only the most recent queries for new viewers', () => {
    const feed = new QueryFeed()
    const received: string[] = []
    for (let n = 0; n < QueryFeed.BACKLOG + 5; n += 1) feed.push(query(n))
    const writes: string[] = []
    const res = {
      writeHead: () => res,
      write: (chunk: string) => writes.push(chunk),
      on: () => res,
    }
    feed.stream(res as never)
    for (const chunk of writes) received.push((JSON.parse(chunk.slice(6)) as TappedQuery).sql)
    expect(received).toHaveLength(QueryFeed.BACKLOG)
    expect(received[0]).toBe('select 5')
  })
})

describe('debug portal password', () => {
  const app = () =>
    createApp([], {
      db: undefined as never,
      queries: new QueryFeed(),
      password: 'sekret',
    })
  const basic = (user: string, pass: string) =>
    `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`

  it('asks for credentials when a password is set', async () => {
    const res = await request(app()).get('/debug')
    expect(res.status).toBe(401)
    expect(res.headers['www-authenticate']).toContain('Basic')
  })

  it('rejects a wrong password or user, on the page and the APIs', async () => {
    for (const path of ['/debug', '/debug/api/snapshot', '/debug/api/queries']) {
      expect(
        (await request(app()).get(path).set('authorization', basic('admin', 'nope'))).status,
      ).toBe(401)
    }
    expect(
      (await request(app()).get('/debug').set('authorization', basic('root', 'sekret'))).status,
    ).toBe(401)
  })

  it('serves the page to admin with the password', async () => {
    const res = await request(app()).get('/debug').set('authorization', basic('admin', 'sekret'))
    expect(res.status).toBe(200)
    expect(res.text).toContain('OpenReel live pipeline')
  })

  it('leaves the status page open', async () => {
    expect((await request(app()).get('/health')).status).toBe(200)
  })
})
