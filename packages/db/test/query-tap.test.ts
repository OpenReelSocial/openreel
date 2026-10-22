import type { LogEvent } from 'kysely'
import { describe, expect, it } from 'vitest'

import { queryTapOptions, tappedQuery } from '../src/query-tap.ts'

function event(sql: string, parameters: unknown[]): LogEvent {
  return {
    level: 'query',
    query: { sql, parameters, query: { kind: 'RawNode' } } as unknown as LogEvent['query'],
    queryDurationMillis: 1.234,
  }
}

describe('query tap', () => {
  it('is off unless DEBUG_QUERY_TAP=1', () => {
    expect(queryTapOptions('appview', {})).toEqual({})
    expect(queryTapOptions('appview', { DEBUG_QUERY_TAP: '0' })).toEqual({})
    expect(queryTapOptions('appview', { DEBUG_QUERY_TAP: '1' })).toEqual({ queryTap: 'appview' })
  })

  it('describes a query with readable parameters', () => {
    const at = new Date('2026-10-22T00:00:00.000Z')
    const q = tappedQuery('feedgen', event('select 1 where a = $1', [new Date(0), 5, { x: 1 }]), at)
    expect(q).toEqual({
      service: 'feedgen',
      sql: 'select 1 where a = $1',
      params: ['1970-01-01T00:00:00.000Z', '5', '{"x":1}'],
      durationMs: 1.2,
      at: '2026-10-22T00:00:00.000Z',
    })
  })

  it('stays within the NOTIFY payload limit', () => {
    const params = Array.from({ length: 50 }, () => 'p'.repeat(5000))
    const q = tappedQuery('media', event('x'.repeat(20_000), params))
    expect(Buffer.byteLength(JSON.stringify(q))).toBeLessThan(8000)
  })
})
