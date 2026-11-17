import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { FileMediaStore, keyPath } from '../src/store.ts'

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

describe('FileMediaStore.remove', () => {
  it("deletes one key's renditions and leaves the others", async () => {
    const root = await mkdtemp(join(tmpdir(), 'openreel-store-'))
    try {
      for (const cid of ['bafkreione', 'bafkreitwo']) {
        await mkdir(join(root, 'did:plc:abc123', cid, 'avc_720'), { recursive: true })
        await writeFile(join(root, 'did:plc:abc123', cid, 'playlist.m3u8'), '#EXTM3U')
      }
      const store = new FileMediaStore(root)

      await store.remove('did:plc:abc123', 'bafkreione')
      // Already gone is not an error.
      await store.remove('did:plc:abc123', 'bafkreione')

      expect(await readdir(join(root, 'did:plc:abc123'))).toEqual(['bafkreitwo'])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
