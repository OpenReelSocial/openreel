import { describe, expect, it } from 'vitest'

import { keyPath } from '../src/store.ts'

describe('keyPath', () => {
  it('joins the raw DID and CID under the root', () => {
    expect(keyPath('/media', 'did:plc:abc123', 'bafkrei')).toBe('/media/did:plc:abc123/bafkrei')
  })

  it.each([
    ['did:plc:a/../../b', 'bafkrei'],
    ['did:plc:abc123', '..'],
  ])('refuses unsafe key %s/%s', (did, cid) => {
    expect(() => keyPath('/media', did, cid)).toThrow(/unsafe media key/)
  })
})
