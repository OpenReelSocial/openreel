#!/usr/bin/env node
// Likes the feed's videos from several demo accounts, unevenly, so the Popular
// feed has a visible order, then waits until Popular reflects it. Used for
// demos:
//
//   make seed-likes                           # 5 accounts, local stack
//   LIKERS=8 make seed-likes                  # more accounts, longer tail
//
// Against the shared AWS environment (sign-up needs an invite there; see
// infra/README.md for the admin password):
//   PUBLIC_URL=https://dev.openreel.social PDS_ADMIN_PASSWORD=... make seed-likes
//
// The videos are shuffled; the first gets LIKERS likes, the next one fewer,
// and so on down to one, and the rest get none. Every run creates new
// accounts (named liker-xxxxxx; set HANDLE_PREFIX to change "liker"), so
// rerunning adds likes on top of the existing ones.

import { endpoints, jsonRequest, session, xrpcPost } from './lib/atproto.mjs'

const LIKE = 'social.openreel.engagement.like'
const POPULAR = 'at://openreel.social/social.openreel.feed.generator/popular'

const { pdsUrl, appviewUrl } = endpoints()
const likers = Number(process.env.LIKERS ?? 5)
if (!Number.isInteger(likers) || likers < 1) throw new Error('LIKERS must be a whole number >= 1')

function feedUrl(feed) {
  const query = new URLSearchParams({ limit: '100', ...(feed ? { feed } : {}) })
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

const { feed: posts } = await jsonRequest(feedUrl())
if (posts.length === 0) throw new Error('the feed is empty; run make seed-videos first')

const order = shuffle(posts).slice(0, likers)
const env = { ...process.env, HANDLE_PREFIX: process.env.HANDLE_PREFIX ?? 'liker' }
const accounts = []
for (let i = 0; i < likers; i++) accounts.push(await session(pdsUrl, env))

// Video i is liked by the first (likers - i) accounts.
const expected = new Map()
for (const [i, post] of order.entries()) {
  const from = accounts.slice(0, likers - i)
  for (const account of from) {
    await xrpcPost(
      pdsUrl,
      'com.atproto.repo.createRecord',
      {
        repo: account.did,
        collection: LIKE,
        record: {
          $type: LIKE,
          subject: { uri: post.uri, cid: post.cid },
          createdAt: new Date().toISOString(),
        },
      },
      account.accessJwt,
    )
  }
  expected.set(post.uri, (post.likeCount ?? 0) + from.length)
  console.log(`+${from.length} ${label(post)}`)
}

process.stdout.write('\nWaiting for the AppView to count them')
const deadline = Date.now() + 60_000
for (;;) {
  const { feed } = await jsonRequest(feedUrl(POPULAR))
  const counted = feed.filter((post) => expected.has(post.uri))
  if (
    counted.length === expected.size &&
    counted.every((post) => post.likeCount === expected.get(post.uri))
  ) {
    console.log('\n\nPopular now starts:')
    for (const post of feed.slice(0, Math.max(likers, 3))) {
      console.log(`  ${String(post.likeCount ?? 0).padStart(3)} ♥  ${label(post)}`)
    }
    break
  }
  if (Date.now() > deadline) {
    throw new Error('the AppView had not counted every like after 60 s; is it indexing?')
  }
  process.stdout.write('.')
  await new Promise((resolve) => setTimeout(resolve, 1_000))
}
