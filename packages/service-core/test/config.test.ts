import { describe, expect, it } from 'vitest'

import { readPort } from '../src/config.ts'

describe('readPort', () => {
  it('falls back when unset or empty', () => {
    expect(readPort(undefined, 3001)).toBe(3001)
    expect(readPort('', 3001)).toBe(3001)
  })

  it('parses a valid port', () => {
    expect(readPort('8080', 3001)).toBe(8080)
  })

  it.each(['0', '-1', '70000', 'abc', '3.5'])('rejects %s', (value) => {
    expect(() => readPort(value, 3001)).toThrow(/Invalid PORT/)
  })
})
