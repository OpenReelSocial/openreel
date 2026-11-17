#!/usr/bin/env node
// Watches, and likes, a few of the feed's newest videos from several demo
// accounts so the Trending feed has a visible order, then waits until Trending
// reflects it. Used for demos:
//
//   make seed-views                           # 10 accounts, local stack
//   VIEWERS=20 make seed-views                # more accounts, stronger signal
//
// Against the shared AWS environment (sign-up needs an invite there; see
// infra/README.md for the admin password):
//   PUBLIC_URL=https://dev.openreel.social PDS_ADMIN_PASSWORD=... make seed-views
//
// Three of the newest videos are shuffled. Every account watches all three:
// the first almost to the end and every account likes it, the second about
// halfway with half the accounts liking it, the third barely, with no likes.
// Writing a watch event publishes it, as when a viewer turns on Share Watch
// History; these accounts stand in for viewers who did. Every run creates new
// accounts (named viewer-xxxxxx; set HANDLE_PREFIX to change "viewer").

import { endpoints, jsonRequest, session, xrpcPost } from './lib/atproto.mjs'

const WATCH = 'social.openreel.engagement.watchEvent'
const LIKE = 'social.openreel.engagement.like'
const LATEST = 'at://openreel.social/social.openreel.feed.generator/recent'
const TRENDING = 'at://openreel.social/social.openreel.feed.generator/trending'

// [share of the video watched, share of accounts that like it], best first.
const PROFILES = [
  [0.95, 1],
  [0.55, 0.5],
  [0.2, 0],
]

const { pdsUrl, appviewUrl } = endpoints()
const viewers = Number(process.env.VIEWERS ?? 10)
if (!Number.isInteger(viewers) || viewers < 1)
  throw new Error('VIEWERS must be a whole number >= 1')

function feedUrl(feed) {
  const query = new URLSearchParams({ limit: '100', feed })
  return `${appviewUrl}/xrpc/social.openreel.feed.getFeed?${query}`
}

function shuffle(items) {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

const label = (post) => post.record?.caption ?? post.uri.split('/').pop()

function create(account, collection, record) {
  return xrpcPost(
    pdsUrl,
    'com.atproto.repo.createRecord',
    { repo: account.did, collection, record: { $type: collection, ...record } },
    account.accessJwt,
  )
}

// The newest videos were posted close together, so recency barely separates them.
const { feed: latest } = await jsonRequest(feedUrl(LATEST))
if (latest.length < PROFILES.length) {
  throw new Error(`the feed has ${latest.length} videos; run make seed-videos first`)
}
const order = shuffle(latest.slice(0, PROFILES.length))

const env = { ...process.env, HANDLE_PREFIX: process.env.HANDLE_PREFIX ?? 'viewer' }
const accounts = []
for (let i = 0; i < viewers; i++) accounts.push(await session(pdsUrl, env))

for (const [i, post] of order.entries()) {
  const [watched, liking] = PROFILES[i]
  const videoDurationMs = post.durationMs ?? 10_000
  const subject = { uri: post.uri, cid: post.cid }
  const likers = Math.round(viewers * liking)
  for (const [j, account] of accounts.entries()) {
    const createdAt = new Date().toISOString()
    await create(account, WATCH, {
      subject,
      watchDurationMs: Math.round(videoDurationMs * watched),
      videoDurationMs,
      rewatchCount: 0,
      context: 'feed',
      createdAt,
    })
    if (j < likers) await create(account, LIKE, { subject, createdAt })
  }
  console.log(`${Math.round(watched * 100)}% watched, ${likers}/${viewers} like  ${label(post)}`)
}

process.stdout.write('\nWaiting for the AppView to count them')
const expected = order.map((post) => post.uri)
const deadline = Date.now() + 60_000
for (;;) {
  const { feed } = await jsonRequest(feedUrl(TRENDING))
  const ranked = feed.map((post) => post.uri).filter((uri) => expected.includes(uri))
  if (ranked.join() === expected.join()) {
    console.log('\n\nTrending now starts:')
    for (const post of feed.slice(0, 5)) console.log(`  ${label(post)}`)
    break
  }
  if (Date.now() > deadline) {
    throw new Error(
      'Trending did not rank the seeded videos in order after 60 s; is the AppView indexing?',
    )
  }
  process.stdout.write('.')
  await new Promise((resolve) => setTimeout(resolve, 1_000))
}
