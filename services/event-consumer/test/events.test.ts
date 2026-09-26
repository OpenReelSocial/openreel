import { describe, expect, it } from 'vitest'

import { EventStore, parseCommitEvent } from '../src/events.ts'

const event = {
  did: 'did:plc:sample',
  time_us: 1_725_911_162_329_308,
  kind: 'commit',
  commit: {
    rev: '3l3qo2vutsw2b',
    operation: 'create',
    collection: 'app.bsky.actor.profile',
    rkey: 'self',
    record: { $type: 'app.bsky.actor.profile', displayName: 'OpenReel Sample' },
    cid: 'bafyrei',
  },
} as const

describe('parseCommitEvent', () => {
  it('accepts a Jetstream commit event', () => {
    expect(parseCommitEvent(JSON.stringify(event))).toEqual(event)
  })

  it('ignores malformed JSON and non-commit markers', () => {
    expect(parseCommitEvent('{')).toBeUndefined()
    expect(parseCommitEvent(JSON.stringify({ kind: 'identity' }))).toBeUndefined()
  })
})

describe('EventStore', () => {
  it('bounds retained events and exposes matching records', () => {
    const store = new EventStore(1)
    store.setConnection('connected')
    store.add(event)
    store.add({ ...event, commit: { ...event.commit, rkey: 'newer' } })

    expect(store.find({ rkey: 'self' })).toEqual([])
    expect(store.find({ collection: 'app.bsky.actor.profile' })).toHaveLength(1)
    expect(store.status()).toMatchObject({
      connection: 'connected',
      observedEvents: 2,
      bufferedEvents: 1,
    })
  })
})
