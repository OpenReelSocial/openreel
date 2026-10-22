import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { PutObjectCommand, PutObjectCommandInput } from '@aws-sdk/client-s3'
import { afterEach, describe, expect, it } from 'vitest'

import { S3MediaStore } from '../src/s3-store.ts'

const DID = 'did:plc:abc123'
const CID = 'bafkreiexample'

class FakeS3 {
  readonly puts: PutObjectCommandInput[] = []
  failOn: string | undefined

  send(command: PutObjectCommand): Promise<unknown> {
    if (command.input.Key === this.failOn) return Promise.reject(new Error('put failed'))
    this.puts.push(command.input)
    return Promise.resolve({})
  }
}

const dirs: string[] = []

async function renditions(store: S3MediaStore, files: string[]): Promise<string> {
  const work = await store.workDir()
  dirs.push(work)
  for (const file of files) {
    await mkdir(dirname(join(work, file)), { recursive: true })
    await writeFile(join(work, file), `contents of ${file}`)
  }
  return work
}

const LAYOUT = [
  'playlist.m3u8',
  'poster.jpg',
  'avc_720/index.m3u8',
  'avc_720/init_0.mp4',
  'avc_720/seg_000.m4s',
  'avc_720/seg_001.m4s',
  'avc_360/index.m3u8',
  'avc_360/init_1.mp4',
  'avc_360/seg_000.m4s',
]

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('S3MediaStore', () => {
  it('uploads every file under <did>/<cid>/ with its content type and an immutable cache header', async () => {
    const s3 = new FakeS3()
    const store = new S3MediaStore(s3, 'media-bucket')
    await store.publish(await renditions(store, LAYOUT), DID, CID)

    expect(s3.puts.map((put) => put.Key).sort()).toEqual(
      LAYOUT.map((file) => `${DID}/${CID}/${file}`).sort(),
    )
    const byKey = new Map(s3.puts.map((put) => [put.Key, put]))
    expect(byKey.get(`${DID}/${CID}/playlist.m3u8`)?.ContentType).toBe(
      'application/vnd.apple.mpegurl',
    )
    expect(byKey.get(`${DID}/${CID}/avc_720/index.m3u8`)?.ContentType).toBe(
      'application/vnd.apple.mpegurl',
    )
    expect(byKey.get(`${DID}/${CID}/avc_720/init_0.mp4`)?.ContentType).toBe('video/mp4')
    expect(byKey.get(`${DID}/${CID}/avc_720/seg_000.m4s`)?.ContentType).toBe('video/iso.segment')
    expect(byKey.get(`${DID}/${CID}/poster.jpg`)?.ContentType).toBe('image/jpeg')
    for (const put of s3.puts) {
      expect(put.Bucket).toBe('media-bucket')
      expect(put.CacheControl).toBe('public, max-age=31536000, immutable')
      expect(Buffer.from(put.Body as Uint8Array).toString()).toBe(
        `contents of ${put.Key?.slice(`${DID}/${CID}/`.length)}`,
      )
    }
  })

  it('uploads the top-level playlist last', async () => {
    const s3 = new FakeS3()
    const store = new S3MediaStore(s3, 'media-bucket')
    await store.publish(await renditions(store, LAYOUT), DID, CID)

    expect(s3.puts.at(-1)?.Key).toBe(`${DID}/${CID}/playlist.m3u8`)
  })

  it('does not upload the playlist when another upload fails', async () => {
    const s3 = new FakeS3()
    s3.failOn = `${DID}/${CID}/avc_360/seg_000.m4s`
    const store = new S3MediaStore(s3, 'media-bucket')

    await expect(store.publish(await renditions(store, LAYOUT), DID, CID)).rejects.toThrow(
      'put failed',
    )
    expect(s3.puts.map((put) => put.Key)).not.toContain(`${DID}/${CID}/playlist.m3u8`)
  })

  it('refuses unknown extensions before uploading anything', async () => {
    const s3 = new FakeS3()
    const store = new S3MediaStore(s3, 'media-bucket')
    const work = await renditions(store, [...LAYOUT, 'avc_720/notes.txt'])

    await expect(store.publish(work, DID, CID)).rejects.toThrow(/no content type/)
    expect(s3.puts).toEqual([])
  })

  it('refuses a work dir without a playlist', async () => {
    const s3 = new FakeS3()
    const store = new S3MediaStore(s3, 'media-bucket')
    const work = await renditions(store, ['poster.jpg'])

    await expect(store.publish(work, DID, CID)).rejects.toThrow(/playlist\.m3u8/)
    expect(s3.puts).toEqual([])
  })

  it.each([
    ['did:plc:../../etc', CID],
    ['not-a-did', CID],
    [DID, '../escape'],
    [DID, 'BAFY'],
  ])('refuses unsafe key %s/%s', async (did, cid) => {
    const s3 = new FakeS3()
    const store = new S3MediaStore(s3, 'media-bucket')
    const work = await renditions(store, LAYOUT)

    await expect(store.publish(work, did, cid)).rejects.toThrow(/unsafe media key/)
    expect(s3.puts).toEqual([])
  })

  it('discard removes the work dir', async () => {
    const store = new S3MediaStore(new FakeS3(), 'media-bucket')
    const work = await renditions(store, LAYOUT)
    await store.discard(work)

    await expect(readdir(work)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
