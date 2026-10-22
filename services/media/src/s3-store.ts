import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join, relative, sep } from 'node:path'

import { PutObjectCommand } from '@aws-sdk/client-s3'

import { assertSafeKey, type MediaStore } from './store.ts'

/** The one S3 call the store makes; `S3Client` satisfies it, tests pass a fake. */
export interface S3Putter {
  send(command: PutObjectCommand): Promise<unknown>
}

const CONTENT_TYPES: Record<string, string> = {
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.mp4': 'video/mp4',
  '.m4s': 'video/iso.segment',
  '.jpg': 'image/jpeg',
}

/** Keys are (author DID, blob CID), so an object never changes once written. */
const CACHE_CONTROL = 'public, max-age=31536000, immutable'

/** Entry point readers fetch first; uploaded only once everything it references exists. */
const PLAYLIST = 'playlist.m3u8'

const UPLOAD_CONCURRENCY = 8

export function contentTypeFor(path: string): string {
  const type = CONTENT_TYPES[extname(path)]
  if (type === undefined) throw new Error(`no content type for media file ${path}`)
  return type
}

/**
 * Publishes renditions to `s3://<bucket>/<did>/<cid>/...`, served by CloudFront
 * on AWS (ADR-0007). Keys use the raw DID (`did:plc:...`): the AppView
 * percent-encodes it in URLs and S3 decodes the path before lookup.
 *
 * Re-publishing a key overwrites its objects one by one. Files an older
 * rendition set had and the new one lacks are left behind, unreferenced by
 * the new playlist.
 */
export class S3MediaStore implements MediaStore {
  readonly #client: S3Putter
  readonly #bucket: string

  constructor(client: S3Putter, bucket: string) {
    this.#client = client
    this.#bucket = bucket
  }

  async workDir(): Promise<string> {
    return mkdtemp(join(tmpdir(), 'openreel-media-'))
  }

  async publish(workDir: string, did: string, cid: string): Promise<void> {
    assertSafeKey(did, cid)
    const files = (await listFiles(workDir)).map((path) =>
      relative(workDir, path).split(sep).join('/'),
    )
    if (!files.includes(PLAYLIST)) throw new Error(`${workDir} has no ${PLAYLIST}`)
    // Fail before uploading anything rather than leave a partial set.
    for (const file of files) contentTypeFor(file)

    const upload = async (file: string): Promise<void> => {
      await this.#client.send(
        new PutObjectCommand({
          Bucket: this.#bucket,
          Key: `${did}/${cid}/${file}`,
          Body: await readFile(join(workDir, file)),
          ContentType: contentTypeFor(file),
          CacheControl: CACHE_CONTROL,
        }),
      )
    }

    const queue = files.filter((file) => file !== PLAYLIST)
    let failed = false
    const uploader = async (): Promise<void> => {
      for (let file = queue.shift(); file !== undefined && !failed; file = queue.shift()) {
        try {
          await upload(file)
        } catch (error) {
          failed = true
          throw error
        }
      }
    }
    await Promise.all(Array.from({ length: UPLOAD_CONCURRENCY }, uploader))
    // A reader never sees a playlist whose segments are missing.
    await upload(PLAYLIST)
  }

  async discard(workDir: string): Promise<void> {
    await rm(workDir, { recursive: true, force: true })
  }
}

async function listFiles(dir: string): Promise<string[]> {
  const files: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...(await listFiles(path)))
    else if (entry.isFile()) files.push(path)
  }
  return files
}
