#!/usr/bin/env node
// Uploads videos to a PDS as social.openreel.video.post records, then waits
// until the AppView serves them as playable HLS in getFeed. Used for demos:
//
//   make seed-videos                          # 6 generated clips, local stack
//   VIDEO_DIR=~/clips make seed-videos        # your own .mp4/.mov files
//
// Against the shared AWS environment (sign-up needs an invite there; see
// infra/README.md for the admin password):
//   PUBLIC_URL=https://dev.openreel.social PDS_ADMIN_PASSWORD=... make seed-videos
//
// Or post as an existing account with SEED_HANDLE and SEED_PASSWORD.
// Needs ffmpeg/ffprobe on PATH.

import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, extname, join } from 'node:path'

import { createVideoPost, endpoints, getFeed, session, uploadBlob } from './lib/atproto.mjs'
import { generateClip, probe, VIDEO_TYPES } from './lib/video.mjs'

const { pdsUrl, appviewUrl } = endpoints()
const count = Number(process.env.COUNT ?? 6)

// Cheap built-in ffmpeg sources, so a demo needs no media files. Avoid the
// fractal/cellular sources (mandelbrot, life): they take minutes to render.
const PATTERNS = [
  ['testsrc2=size=1080x1920:rate=30', 'Test pattern'],
  ['smptehdbars=size=1080x1920:rate=30', 'Color bars'],
  ['rgbtestsrc=size=1080x1920:rate=30', 'RGB test'],
  ['testsrc=size=1080x1920:rate=30', 'Counter'],
]

function generateClips() {
  const dir = mkdtempSync(join(tmpdir(), 'openreel-seed-'))
  const clips = []
  for (let i = 0; i < count; i += 1) {
    const [source, caption] = PATTERNS[i % PATTERNS.length]
    const path = join(dir, `clip-${i}.mp4`)
    generateClip(path, { source, frequency: 220 * (i + 2), seconds: 8 })
    clips.push({ path, caption: `${caption} #${i + 1}`, mimeType: 'video/mp4' })
  }
  return clips
}

function clipsFromDir(dir) {
  return readdirSync(dir)
    .filter((name) => VIDEO_TYPES[extname(name).toLowerCase()])
    .sort()
    .map((name) => ({
      path: join(dir, name),
      caption: basename(name, extname(name)).replaceAll(/[-_]+/g, ' '),
      mimeType: VIDEO_TYPES[extname(name).toLowerCase()],
    }))
}

async function waitForFeed(uris) {
  const pending = new Set(uris)
  const deadline = Date.now() + 10 * 60_000
  while (pending.size > 0 && Date.now() < deadline) {
    const { feed } = await getFeed(appviewUrl, 100)
    for (const item of feed) {
      if (pending.delete(item.uri)) console.log(`  playable: ${item.playlist}`)
    }
    if (pending.size > 0) await new Promise((resolve) => setTimeout(resolve, 3_000))
  }
  if (pending.size > 0) throw new Error(`${pending.size} post(s) not in the feed after 10 minutes`)
}

const clips = process.env.VIDEO_DIR ? clipsFromDir(process.env.VIDEO_DIR) : generateClips()
if (clips.length === 0) throw new Error(`no .mp4/.mov files in ${process.env.VIDEO_DIR}`)

const account = await session(pdsUrl)
const uris = []
for (const clip of clips) {
  const bytes = readFileSync(clip.path)
  const blob = await uploadBlob(pdsUrl, account, bytes, clip.mimeType)
  const uri = await createVideoPost(pdsUrl, account, {
    blob,
    caption: clip.caption,
    probe: probe(clip.path),
  })
  uris.push(uri)
  console.log(`Posted ${clip.caption} (${(bytes.length / 1e6).toFixed(1)} MB): ${uri}`)
}

console.log(`Waiting for ${uris.length} video(s) to be indexed and transcoded...`)
await waitForFeed(uris)
console.log(`Done. Feed: ${appviewUrl}/xrpc/social.openreel.feed.getFeed`)
