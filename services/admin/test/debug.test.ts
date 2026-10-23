import type { TraceEvent } from '@openreel/db'
import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createApp } from '../src/app.ts'
import { TraceFeed, type DebugMessage } from '../src/debug.ts'

const at = (ms: number) => new Date(Date.UTC(2026, 9, 22, 0, 0, 0, ms)).toISOString()

const query = (trace: string | undefined, ms: number): TraceEvent => ({
  kind: 'sql',
  service: 'appview',
  ...(trace === undefined ? {} : { trace }),
  purpose: 'Record the like',
  op: 'insert',
  writes: 'video_like',
  reads: [],
  rows: 1,
  sql: 'insert into "video_like"',
  params: [],
  at: at(ms),
  ms: 1,
})

const root = (trace: string): TraceEvent => ({
  kind: 'firehose',
  service: 'appview',
  trace,
  event: 'commit',
  did: 'did:plc:abc',
  relayMs: 120,
  at: at(0),
  ms: 5,
})

/** Collects what a page connected to `feed` would receive. */
function listen(feed: TraceFeed): DebugMessage[] {
  const messages: DebugMessage[] = []
  const res = {
    writeHead: () => res,
    write: (chunk: string) => {
      if (chunk.startsWith('data: ')) messages.push(JSON.parse(chunk.slice(6)) as DebugMessage)
    },
    on: () => res,
  }
  feed.stream(res as never)
  return messages
}

afterEach(() => vi.useRealTimers())

describe('debug system map', () => {
  it('serves the page, explaining when there is no database', async () => {
    const res = await request(createApp([])).get('/debug')
    expect(res.status).toBe(200)
    expect(res.text).toContain('Where your data goes')
    expect(res.text).toContain('no DATABASE_URL')
  })

  it('reports the snapshot as not configured without a database', async () => {
    const res = await request(createApp([])).get('/debug/api/snapshot')
    expect(res.status).toBe(503)
  })

  it('sends a trace once its root has arrived and late events have had time to', async () => {
    vi.useFakeTimers()
    const feed = new TraceFeed((did) =>
      Promise.resolve(did === 'did:plc:abc' ? 'alice.test' : undefined),
    )
    const messages = listen(feed)

    feed.push(query('t1', 3))
    feed.push(root('t1'))
    expect(messages).toEqual([])
    // Arrives after the root, as it can when two connections race.
    feed.push(query('t1', 4))
    await vi.advanceTimersByTimeAsync(1_000)

    expect(messages).toHaveLength(1)
    const message = messages[0]
    expect(message?.type).toBe('trace')
    if (message?.type !== 'trace') return
    expect(message.trace.handle).toBe('alice.test')
    expect(message.trace.events.map((e) => e.kind)).toEqual(['firehose', 'sql', 'sql'])
  })

  it('leaves out work outside any trace', () => {
    const feed = new TraceFeed()
    const messages = listen(feed)
    feed.push(query(undefined, 0))
    expect(messages).toEqual([])
  })

  it('gives a new page nothing that happened before it connected', async () => {
    vi.useFakeTimers()
    const feed = new TraceFeed()
    feed.push(root('t1'))
    feed.push(query(undefined, 0))
    await vi.advanceTimersByTimeAsync(1_000)
    expect(listen(feed)).toEqual([])
  })
})

describe('debug portal password', () => {
  const app = () =>
    createApp([], {
      db: undefined as never,
      traces: new TraceFeed(),
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
    for (const path of ['/debug', '/debug/api/snapshot', '/debug/api/stream']) {
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
    expect(res.text).toContain('Where your data goes')
  })

  it('leaves the status page open', async () => {
    expect((await request(app()).get('/health')).status).toBe(200)
  })
})
