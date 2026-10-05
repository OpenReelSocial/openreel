import { describe, expect, it } from 'vitest'

import { parseEvent } from '../src/indexer/events.ts'
import { subscribeUrl } from '../src/indexer/subscription.ts'
import { did, postRecordJson } from './fixtures.ts'

describe('parseEvent', () => {
  it('parses a commit', () => {
    const payload = JSON.stringify({
      did,
      time_us: 1,
      kind: 'commit',
      commit: {
        rev: 'r',
        operation: 'create',
        collection: 'social.openreel.video.post',
        rkey: '3abc',
        record: postRecordJson(),
        cid: 'bafy',
      },
    })
    expect(parseEvent(payload)).toMatchObject({ kind: 'commit', commit: { rkey: '3abc' } })
  })

  it('parses identity and account events', () => {
    expect(
      parseEvent(JSON.stringify({ did, time_us: 1, kind: 'identity', identity: { did } })),
    ).toMatchObject({ kind: 'identity' })
    expect(
      parseEvent(
        JSON.stringify({ did, time_us: 1, kind: 'account', account: { did, active: false } }),
      ),
    ).toMatchObject({ kind: 'account' })
  })

  it.each([
    ['not JSON', '{'],
    ['no time_us', JSON.stringify({ did, kind: 'identity', identity: {} })],
    ['unknown kind', JSON.stringify({ did, time_us: 1, kind: 'other' })],
    [
      'bad operation',
      JSON.stringify({
        did,
        time_us: 1,
        kind: 'commit',
        commit: { operation: 'upsert', collection: 'c', rkey: 'r' },
      }),
    ],
    [
      'account without active',
      JSON.stringify({ did, time_us: 1, kind: 'account', account: { did } }),
    ],
  ])('ignores %s', (_name, payload) => {
    expect(parseEvent(payload)).toBeUndefined()
  })
})

describe('subscribeUrl', () => {
  it('replaces wantedCollections and resumes from the cursor', () => {
    const url = new URL(
      subscribeUrl('ws://jetstream:6008/subscribe?wantedCollections=x', ['a', 'b'], 42),
    )
    expect(url.searchParams.getAll('wantedCollections')).toEqual(['a', 'b'])
    expect(url.searchParams.get('cursor')).toBe('42')
  })

  it('starts from the oldest retained event when there is no cursor', () => {
    expect(
      new URL(subscribeUrl('ws://j/subscribe', ['a'], undefined)).searchParams.get('cursor'),
    ).toBe('1')
  })
})
