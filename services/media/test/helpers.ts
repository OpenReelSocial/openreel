import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { CID } from 'multiformats/cid'
import * as raw from 'multiformats/codecs/raw'
import { create } from 'multiformats/hashes/digest'
import { sha256 } from 'multiformats/hashes/sha2'

export const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

/** The CID a PDS assigns a blob: CIDv1, raw codec, sha-256. */
export function blobCid(bytes: Buffer): string {
  const digest = create(sha256.code, createHash('sha256').update(bytes).digest())
  return CID.createV1(raw.code, digest).toString()
}

/** Generates a short test clip with ffmpeg's built-in sources. */
export function makeClip(
  path: string,
  { width = 1080, height = 1920, seconds = 3, audio = true } = {},
): void {
  const args = [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `testsrc2=size=${width}x${height}:rate=30:duration=${seconds}`,
  ]
  if (audio) args.push('-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`)
  args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p')
  if (audio) args.push('-c:a', 'aac', '-shortest')
  execFileSync('ffmpeg', [...args, path])
}

/** Copies a clip, tagging it with a display rotation the way phones do. */
export function rotateClip(input: string, output: string, degrees: number): void {
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-display_rotation',
    String(degrees),
    '-i',
    input,
    '-c',
    'copy',
    output,
  ])
}

/** A stand-in PDS serving one blob over getBlob. */
export async function fakePds(
  blobs: Map<string, Buffer>,
): Promise<{ url: string; server: Server; requests: string[] }> {
  const requests: string[] = []
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    requests.push(url.pathname + url.search)
    const body =
      url.pathname === '/xrpc/com.atproto.sync.getBlob' &&
      blobs.get(url.searchParams.get('cid') ?? '')
    if (!body) {
      res.writeHead(404).end('{"error":"BlobNotFound"}')
      return
    }
    res.writeHead(200, { 'content-type': 'application/octet-stream' }).end(body)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { url: `http://127.0.0.1:${port}`, server, requests }
}
