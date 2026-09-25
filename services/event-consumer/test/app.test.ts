import request from 'supertest'
import { describe, expect, it } from 'vitest'

import { createApp } from '../src/app.ts'
import { EventStore } from '../src/events.ts'

describe('event consumer API', () => {
  it('reports connection state and observed records', async () => {
    const store = new EventStore()
    store.setConnection('connected')
    store.add({
      did: 'did:plc:sample',
      time_us: 1_725_911_162_329_308,
      kind: 'commit',
      commit: {
        rev: 'rev',
        operation: 'create',
        collection: 'app.bsky.actor.profile',
        rkey: 'self',
      },
    })
    const app = createApp(store)

    const status = await request(app).get('/events/status')
    expect(status.status).toBe(200)
    expect(status.body).toMatchObject({ connection: 'connected', observedEvents: 1 })
    expect((await request(app).get('/ready')).status).toBe(200)

    const events = await request(app)
      .get('/events')
      .query({ did: 'did:plc:sample', collection: 'app.bsky.actor.profile', rkey: 'self' })
    expect(events.status).toBe(200)
    expect(events.body).toMatchObject({ events: [expect.any(Object)] })
  })

  it('is not ready before its event-stream connection opens', async () => {
    const res = await request(createApp(new EventStore())).get('/ready')

    expect(res.status).toBe(503)
    expect(res.body).toMatchObject({ connection: 'connecting' })
  })
})
