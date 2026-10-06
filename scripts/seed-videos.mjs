#!/usr/bin/env node
// Uploads videos to a PDS as social.openreel.video.post records, then waits
// until the AppView serves them as playable HLS in getFeed. Used for demos:
//
//   make seed-videos                          # 6 generated clips, local stack
//   VIDEO_DIR=~/clips make seed-videos        # your own .mp4/.mov files
//
// Against the dev server (sign-up needs an invite there):
//   PDS_URL=https://openreel.zackmurry.com \
//   APPVIEW_URL=https://openreel.zackmurry.com/appview \
//   HANDLE_DOMAIN=.openreel.zackmurry.com PDS_ADMIN_PASSWORD=... make seed-videos
//
// Or post as an existing account with SEED_HANDLE and SEED_PASSWORD.
// Needs ffmpeg/ffprobe on PATH.

import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, extname, join } from 'node:path'

const pdsUrl = (process.env.PDS_URL ?? 'http://localhost:3000').replace(/\/+$/, '')
const appviewUrl = (process.env.APPVIEW_URL ?? 'http://localhost:3001').replace(/\/+$/, '')
const handleDomain = process.env.HANDLE_DOMAIN ?? '.pds.example.com'
const count = Number(process.env.COUNT ?? 6)

async function jsonRequest(url, init = {}) {
  const response = await fetch(url, init)
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(
      `${init.method ?? 'GET'} ${url} failed (${response.status}): ${JSON.stringify(body)}`,
    )
  }
  return body
}

function post(path, body, token) {
  return jsonRequest(`${pdsUrl}/xrpc/${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
}

async function session() {
  if (process.env.SEED_HANDLE && process.env.SEED_PASSWORD) {
    return post('com.atproto.server.createSession', {
      identifier: process.env.SEED_HANDLE,
      password: process.env.SEED_PASSWORD,
    })
  }

  let inviteCode
  if (process.env.PDS_ADMIN_PASSWORD) {
    const auth = Buffer.from(`admin:${process.env.PDS_ADMIN_PASSWORD}`).toString('base64')
    const invite = await jsonRequest(`${pdsUrl}/xrpc/com.atproto.server.createInviteCode`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Basic ${auth}` },
      body: JSON.stringify({ useCount: 1 }),
    })
    inviteCode = invite.code
  }

  const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 6)
  const password = `openreel-demo-${crypto.randomUUID()}`
  const account = await post('com.atproto.server.createAccount', {
    handle: `demo-${suffix}${handleDomain}`,
    email: `demo-${suffix}@example.com`,
    password,
    ...(inviteCode ? { inviteCode } : {}),
  })
  console.log(`Created ${account.handle} (password: ${password})`)
  return account
}

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
    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      source,
      '-f',
      'lavfi',
      '-i',
      `sine=frequency=${220 * (i + 2)}`,
      '-t',
      '8',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-movflags',
      '+faststart',
      path,
    ])
    clips.push({ path, caption: `${caption} #${i + 1}`, mimeType: 'video/mp4' })
  }
  return clips
}

function clipsFromDir(dir) {
  const types = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime' }
  return readdirSync(dir)
    .filter((name) => types[extname(name).toLowerCase()])
    .sort()
    .map((name) => ({
      path: join(dir, name),
      caption: basename(name, extname(name)).replaceAll(/[-_]+/g, ' '),
      mimeType: types[extname(name).toLowerCase()],
    }))
}

function probe(path) {
  const out = execFileSync('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=width,height:stream_side_data=rotation:format=duration',
    '-of',
    'json',
    path,
  ])
  const data = JSON.parse(out.toString())
  const stream = data.streams[0]
  const rotation = Math.abs(
    stream.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? 0,
  )
  const [width, height] =
    rotation % 180 === 90 ? [stream.height, stream.width] : [stream.width, stream.height]
  const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b))
  const d = gcd(width, height)
  return {
    durationMs: Math.round(Number(data.format.duration) * 1000),
    aspectRatio: { width: width / d, height: height / d },
  }
}

async function waitForFeed(uris) {
  const pending = new Set(uris)
  const deadline = Date.now() + 10 * 60_000
  while (pending.size > 0 && Date.now() < deadline) {
    const { feed } = await jsonRequest(`${appviewUrl}/xrpc/social.openreel.feed.getFeed?limit=100`)
    for (const item of feed) {
      if (pending.delete(item.uri)) console.log(`  playable: ${item.playlist}`)
    }
    if (pending.size > 0) await new Promise((resolve) => setTimeout(resolve, 3_000))
  }
  if (pending.size > 0) throw new Error(`${pending.size} post(s) not in the feed after 10 minutes`)
}

const clips = process.env.VIDEO_DIR ? clipsFromDir(process.env.VIDEO_DIR) : generateClips()
if (clips.length === 0) throw new Error(`no .mp4/.mov files in ${process.env.VIDEO_DIR}`)

const { did, accessJwt } = await session()
const uris = []
for (const clip of clips) {
  const bytes = readFileSync(clip.path)
  const upload = await jsonRequest(`${pdsUrl}/xrpc/com.atproto.repo.uploadBlob`, {
    method: 'POST',
    headers: { 'content-type': clip.mimeType, authorization: `Bearer ${accessJwt}` },
    body: bytes,
  })
  const { uri } = await post(
    'com.atproto.repo.createRecord',
    {
      repo: did,
      collection: 'social.openreel.video.post',
      record: {
        $type: 'social.openreel.video.post',
        video: upload.blob,
        caption: clip.caption,
        ...probe(clip.path),
        createdAt: new Date().toISOString(),
      },
    },
    accessJwt,
  )
  uris.push(uri)
  console.log(`Posted ${clip.caption} (${(bytes.length / 1e6).toFixed(1)} MB): ${uri}`)
}

console.log(`Waiting for ${uris.length} video(s) to be indexed and transcoded...`)
await waitForFeed(uris)
console.log(`Done. Feed: ${appviewUrl}/xrpc/social.openreel.feed.getFeed`)
