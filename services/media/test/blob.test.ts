import { mkdtemp, readFile } from 'node:fs/promises'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { BlobError, BlobFetcher } from '../src/blob.ts'
import { blobCid, fakePds } from './helpers.ts'

const did = 'did:plc:ri7muaelw3trwgd2eda7tuf2'
const bytes = Buffer.from('not really a video, but bytes are bytes')
const cid = blobCid(bytes)
const otherBytes = Buffer.from('a different blob')

describe('BlobFetcher', () => {
  let pds: { url: string; server: Server; requests: string[] }
  let dir: string
  const publicOrigin = 'https://pds.openreel.test'

  beforeAll(async () => {
    // The fake PDS serves the wrong bytes under otherCid to simulate tampering.
    pds = await fakePds(
      new Map([
        [cid, bytes],
        [blobCid(Buffer.from('x')), otherBytes],
      ]),
    )
    dir = await mkdtemp(join(tmpdir(), 'media-blob-'))
  })

  afterAll(() => {
    pds.server.close()
  })

  function fetcher(maxBytes = 1_000) {
    return new BlobFetcher({ aliases: new Map([[publicOrigin, pds.url]]), maxBytes })
  }

  it('downloads through an alias and verifies the CID', async () => {
    const dest = join(dir, 'ok')
    await fetcher().download(`${publicOrigin}/`, did, cid, dest)

    expect(await readFile(dest)).toEqual(bytes)
    expect(pds.requests.at(-1)).toBe(
      `/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${cid}`,
    )
  })

  it('rejects bytes that do not hash to the CID', async () => {
    await expect(
      fetcher().download(publicOrigin, did, blobCid(Buffer.from('x')), join(dir, 'bad')),
    ).rejects.toThrow(/does not match its CID/)
  })

  it('rejects blobs over the size limit', async () => {
    await expect(fetcher(10).download(publicOrigin, did, cid, join(dir, 'big'))).rejects.toThrow(
      BlobError,
    )
  })

  it('reports a missing blob', async () => {
    const missing = blobCid(Buffer.from('nobody has this'))
    await expect(fetcher().download(publicOrigin, did, missing, join(dir, 'gone'))).rejects.toThrow(
      /HTTP 404/,
    )
  })

  it('refuses private addresses that are not aliased', async () => {
    const unaliased = new BlobFetcher({ aliases: new Map(), maxBytes: 1_000 })
    const before = pds.requests.length

    await expect(unaliased.download(pds.url, did, cid, join(dir, 'ssrf'))).rejects.toThrow()
    expect(pds.requests.length).toBe(before)
  })
})
