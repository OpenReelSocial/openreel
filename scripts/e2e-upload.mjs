#!/usr/bin/env node
// The demo's golden path, end to end against a running deployment: post one
// short video to the PDS, wait until the AppView's getFeed serves it, then
// fetch it the way a player would. Prints the elapsed time of each stage and
// exits non-zero if any stage fails or the whole run exceeds the timeout.
//
//   make up && make e2e-upload                                  # local stack
//   PUBLIC_URL=https://dev.openreel.social PDS_ADMIN_PASSWORD=... make e2e-upload
//
// Endpoints as in scripts/smoke.mjs (PUBLIC_URL, APPVIEW_URL). The account is
// SEED_HANDLE/SEED_PASSWORD, else a new one (invite via PDS_ADMIN_PASSWORD when
// the PDS requires one). VIDEO_FILE posts your own clip instead of a generated
// 3-second one. E2E_TIMEOUT_SECONDS (default 300) bounds the whole run.
// Needs ffmpeg/ffprobe on PATH.

import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'

import { createVideoPost, endpoints, getFeed, session, uploadBlob } from './lib/atproto.mjs'
import { checkPlayback } from './lib/playback.mjs'
import { createReport } from './lib/report.mjs'
import { generateClip, probe, VIDEO_TYPES } from './lib/video.mjs'

const { pdsUrl, appviewUrl } = endpoints()
const timeoutMs = Number(process.env.E2E_TIMEOUT_SECONDS ?? 300) * 1000
const started = performance.now()
const deadline = Date.now() + timeoutMs
const stages = []

const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`

/** Runs one stage, records how long it took, and aborts the run on failure. */
async function stage(name, fn) {
  const stageStarted = performance.now()
  try {
    const result = await fn()
    const ms = performance.now() - stageStarted
    stages.push([name, ms])
    console.log(`  ${name}: ${seconds(ms)} (total ${seconds(performance.now() - started)})`)
    return result
  } catch (error) {
    console.error(
      `FAIL ${name} after ${seconds(performance.now() - stageStarted)}: ${error.message}`,
    )
    process.exit(1)
  }
}

console.log(`PDS ${pdsUrl}\nAppView ${appviewUrl}\n`)

const clip = await stage('prepare clip', () => {
  if (process.env.VIDEO_FILE) {
    const mimeType = VIDEO_TYPES[extname(process.env.VIDEO_FILE).toLowerCase()]
    if (!mimeType) throw new Error(`${process.env.VIDEO_FILE} is not .mp4/.m4v/.mov`)
    return { path: process.env.VIDEO_FILE, mimeType }
  }
  const path = join(mkdtempSync(join(tmpdir(), 'openreel-e2e-')), 'e2e.mp4')
  generateClip(path, { source: 'testsrc2=size=1080x1920:rate=30', frequency: 440, seconds: 3 })
  return { path, mimeType: 'video/mp4' }
})

const account = await stage('session', () => session(pdsUrl))

const bytes = readFileSync(clip.path)
const blob = await stage('upload', () => uploadBlob(pdsUrl, account, bytes, clip.mimeType))
console.log(`    ${(bytes.length / 1e6).toFixed(2)} MB, blob ${blob.ref.$link}`)

const caption = `e2e upload ${new Date().toISOString()}`
const uri = await stage('post record', () =>
  createVideoPost(pdsUrl, account, { blob, caption, probe: probe(clip.path) }),
)
console.log(`    ${uri}`)

// getFeed only lists posts whose media is ready, so this one stage covers both
// indexing from the firehose and transcoding to HLS; neither is visible
// separately from outside the deployment.
const item = await stage('indexed + transcoded (in getFeed)', async () => {
  while (Date.now() < deadline) {
    const { feed } = await getFeed(appviewUrl, 100)
    const found = feed.find((post) => post.uri === uri)
    if (found?.playlist) return found
    await new Promise((resolve) => setTimeout(resolve, 2_000))
  }
  throw new Error(`not in getFeed within ${seconds(timeoutMs)} (E2E_TIMEOUT_SECONDS)`)
})
console.log(`    ${item.playlist}`)

await stage('playable', async () => {
  const report = createReport()
  await checkPlayback(report, item, '   ')
  if (report.failures > 0) throw new Error(`${report.failures} playback check(s) failed`)
})

const total = performance.now() - started
console.log(`\nStage times:`)
for (const [name, ms] of stages) console.log(`  ${name.padEnd(36)} ${seconds(ms).padStart(8)}`)
console.log(`  ${'total'.padEnd(36)} ${seconds(total).padStart(8)}`)
if (total > timeoutMs) {
  console.error(`FAIL total ${seconds(total)} exceeds ${seconds(timeoutMs)} (E2E_TIMEOUT_SECONDS)`)
  process.exit(1)
}
console.log('Upload to playback succeeded.')
