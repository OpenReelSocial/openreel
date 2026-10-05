import { describe, expect, it, vi } from 'vitest'

import { parseDidDocument, PlcResolver } from '../src/identity.ts'

const did = 'did:plc:ri7muaelw3trwgd2eda7tuf2'

function doc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: did,
    alsoKnownAs: ['at://Alice.openreel.social'],
    service: [
      {
        id: '#atproto_pds',
        type: 'AtprotoPersonalDataServer',
        serviceEndpoint: 'https://pds.openreel.social/',
      },
    ],
    ...overrides,
  }
}

describe('parseDidDocument', () => {
  it('extracts the handle, lowercased, and the PDS origin', () => {
    expect(parseDidDocument(did, doc())).toEqual({
      did,
      handle: 'alice.openreel.social',
      pds: 'https://pds.openreel.social',
    })
  })

  it('accepts a fully qualified service id', () => {
    const service = [
      {
        id: `${did}#atproto_pds`,
        type: 'AtprotoPersonalDataServer',
        serviceEndpoint: 'http://pds:3000',
      },
    ]
    expect(parseDidDocument(did, doc({ service })).pds).toBe('http://pds:3000')
  })

  it('omits what the document does not declare', () => {
    expect(parseDidDocument(did, { id: did })).toEqual({ did })
  })

  it('ignores non-http PDS endpoints', () => {
    const service = [
      { id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'file:///etc' },
    ]
    expect(parseDidDocument(did, doc({ service })).pds).toBeUndefined()
  })

  it('rejects a document for a different DID', () => {
    expect(() => parseDidDocument(did, doc({ id: 'did:plc:other' }))).toThrow(/does not describe/)
  })
})

describe('PlcResolver', () => {
  it('fetches the document from the configured directory', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(Response.json(doc())))
    const resolver = new PlcResolver('http://plc:8080/', { fetch: fetchMock })

    await expect(resolver.resolve(did)).resolves.toMatchObject({ handle: 'alice.openreel.social' })
    expect(fetchMock).toHaveBeenCalledWith(`http://plc:8080/${did}`, expect.anything())
  })

  it('refuses DID methods other than plc', async () => {
    const fetchMock = vi.fn()
    const resolver = new PlcResolver('http://plc:8080', { fetch: fetchMock as typeof fetch })

    await expect(resolver.resolve('did:web:evil.example')).rejects.toThrow(/unsupported DID/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports a failed lookup', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response('', { status: 404 })))
    const resolver = new PlcResolver('http://plc:8080', { fetch: fetchMock })

    await expect(resolver.resolve(did)).rejects.toThrow(/HTTP 404/)
  })
})
