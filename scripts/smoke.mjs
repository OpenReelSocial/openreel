#!/usr/bin/env node
// Black-box smoke test of a running OpenReel deployment: service health, the
// deployed commit, a non-empty feed, and that the first post actually plays
// (playlists, a segment, the thumbnail). Exits non-zero if any check fails.
//
//   make up && make seed-videos && make smoke         # local stack
//   PUBLIC_URL=https://dev.openreel.social make smoke  # deployed host
//
// PUBLIC_URL is the PDS origin. APPVIEW_URL and PLC_URL default to
// ${PUBLIC_URL}/appview and ${PUBLIC_URL}/plc on an https host, else to the
// local ports. EXPECT_SHA fails the run unless the AppView reports that
// commit; ALLOW_EMPTY_FEED=1 turns an empty feed into a warning.

import { endpoints } from './lib/atproto.mjs'
import { checkPlayback } from './lib/playback.mjs'
import { createReport } from './lib/report.mjs'

const { pdsUrl, appviewUrl, plcUrl } = endpoints()
const expectSha = process.env.EXPECT_SHA
const allowEmptyFeed = process.env.ALLOW_EMPTY_FEED === '1'

async function get(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  const text = await response.text()
  if (response.status !== 200) throw new Error(`HTTP ${response.status} for ${url}: ${text}`)
  return { response, text }
}

async function getJson(url) {
  const { text } = await get(url)
  try {
    return { text, json: JSON.parse(text) }
  } catch {
    throw new Error(`${url} did not return JSON: ${text.slice(0, 200)}`)
  }
}

console.log(`PDS ${pdsUrl}\nAppView ${appviewUrl}\nPLC ${plcUrl}\n`)
const report = createReport()

await report.check('PDS health', async () => {
  const { json } = await getJson(`${pdsUrl}/xrpc/_health`)
  return json.version ? `version ${json.version}` : undefined
})

await report.check('PDS describeServer', async () => {
  const { json } = await getJson(`${pdsUrl}/xrpc/com.atproto.server.describeServer`)
  if (!Array.isArray(json.availableUserDomains)) throw new Error('no availableUserDomains')
  return `did ${json.did}, domains ${json.availableUserDomains.join(' ')}`
})

await report.check('PLC health', async () => (await get(`${plcUrl}/_health`)).text.trim())

await report.check('AppView health', async () => {
  const { text, json } = await getJson(`${appviewUrl}/health`)
  // Same test as the deploy workflow: the health body contains the commit.
  if (expectSha && !text.includes(expectSha)) {
    throw new Error(`expected version ${expectSha}, got ${json.version}`)
  }
  return `version ${json.version}`
})

let first
await report.check('AppView getFeed', async () => {
  const { json } = await getJson(`${appviewUrl}/xrpc/social.openreel.feed.getFeed?limit=5`)
  if (!Array.isArray(json.feed)) throw new Error('response has no feed array')
  first = json.feed[0]
  if (!first && !allowEmptyFeed) {
    throw new Error('feed is empty (post a video, or set ALLOW_EMPTY_FEED=1)')
  }
  return first ? `${json.feed.length} post(s), first ${first.uri}` : 'empty'
})

if (first) {
  await checkPlayback(report, first, 'first post')
} else if (allowEmptyFeed) {
  report.warn('playback', 'feed is empty; ALLOW_EMPTY_FEED=1, so playback is not checked')
}

console.log(
  report.failures === 0 ? '\nAll checks passed.' : `\n${report.failures} check(s) failed.`,
)
process.exitCode = report.failures === 0 ? 0 : 1
