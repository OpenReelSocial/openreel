import { describe, expect, it } from 'vitest'

import { cursorName, subscribeUrl } from '../src/indexer/subscription.ts'

describe('Jetstream subscription', () => {
  it('names the cursor after the collection set, in any order', () => {
    expect(cursorName(['b.c', 'a.b'])).toBe(cursorName(['a.b', 'b.c']))
    // Adding a collection starts a fresh cursor, so retained history replays.
    expect(cursorName(['a.b', 'b.c', 'c.d'])).not.toBe(cursorName(['a.b', 'b.c']))
  })

  it('starts from the oldest retained event without a saved cursor', () => {
    const url = new URL(subscribeUrl('ws://jetstream/subscribe', ['a.b', 'c.d'], undefined))
    expect(url.searchParams.getAll('wantedCollections')).toEqual(['a.b', 'c.d'])
    expect(url.searchParams.get('cursor')).toBe('1')
  })
})
