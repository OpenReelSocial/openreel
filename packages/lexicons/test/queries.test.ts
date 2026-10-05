// Contract tests for the feed queries and the hydrated post view: valid
// parameters and outputs pass, representative invalid ones fail.

import { lexToJson } from '@atproto/lexicon'
import { describe, expect, it } from 'vitest'

import { type SocialOpenreelVideoDefs, ids, lexicons } from '../src/index.ts'
import { sampleCid, sampleDid, samplePostUri, videoPost } from './fixtures.ts'

const feedUri = 'at://openreel.social/social.openreel.feed.generator/recent'

function postView(): SocialOpenreelVideoDefs.PostView {
  return {
    uri: samplePostUri,
    cid: sampleCid,
    author: { did: sampleDid, handle: 'alice.openreel.social' },
    record: lexToJson(videoPost()) as {
      [x: string]: unknown
    },
    playlist: `https://media.openreel.social/${sampleDid}/${sampleCid}/playlist.m3u8`,
    thumbnail: `https://media.openreel.social/${sampleDid}/${sampleCid}/poster.jpg`,
    aspectRatio: { width: 9, height: 16 },
    durationMs: 15_250,
    indexedAt: '2026-10-05T12:00:00.000Z',
  }
}

describe(ids.SocialOpenreelFeedGetFeedSkeleton, () => {
  const nsid = ids.SocialOpenreelFeedGetFeedSkeleton

  it('accepts a feed URI with optional paging', () => {
    expect(() => lexicons.assertValidXrpcParams(nsid, { feed: feedUri })).not.toThrow()
    expect(() =>
      lexicons.assertValidXrpcParams(nsid, { feed: feedUri, limit: 10, cursor: 'abc' }),
    ).not.toThrow()
  })

  it.each([
    ['missing feed', {}],
    ['feed that is not an AT-URI', { feed: 'recent' }],
    ['limit above 100', { feed: feedUri, limit: 101 }],
    ['limit below 1', { feed: feedUri, limit: 0 }],
  ])('rejects %s', (_name, params) => {
    expect(() => lexicons.assertValidXrpcParams(nsid, params)).toThrow()
  })

  it('accepts a skeleton of post URIs', () => {
    const output = { cursor: 'next', feed: [{ post: samplePostUri }] }
    expect(() => lexicons.assertValidXrpcOutput(nsid, output)).not.toThrow()
    expect(() => lexicons.assertValidXrpcOutput(nsid, { feed: [] })).not.toThrow()
  })

  it('rejects skeleton entries without a valid post URI', () => {
    expect(() => lexicons.assertValidXrpcOutput(nsid, { feed: [{}] })).toThrow()
    expect(() => lexicons.assertValidXrpcOutput(nsid, { feed: [{ post: 'nope' }] })).toThrow()
  })
})

describe(ids.SocialOpenreelFeedGetFeed, () => {
  const nsid = ids.SocialOpenreelFeedGetFeed

  it('accepts no parameters, since the feed defaults', () => {
    expect(() => lexicons.assertValidXrpcParams(nsid, {})).not.toThrow()
    expect(() => lexicons.assertValidXrpcParams(nsid, { feed: feedUri, limit: 5 })).not.toThrow()
  })

  it('accepts hydrated post views', () => {
    const output = { cursor: 'next', feed: [postView()] }
    expect(() => lexicons.assertValidXrpcOutput(nsid, output)).not.toThrow()
  })

  it('accepts a post view with only the required fields', () => {
    const { uri, cid, author, record, playlist, indexedAt } = postView()
    const output = {
      feed: [{ uri, cid, author: { did: author.did }, record, playlist, indexedAt }],
    }
    expect(() => lexicons.assertValidXrpcOutput(nsid, output)).not.toThrow()
  })

  it.each<[string, (view: Record<string, unknown>) => void]>([
    ['missing playlist', (v) => delete v['playlist']],
    ['playlist that is not a URI', (v) => (v['playlist'] = 'playlist.m3u8')],
    ['author without a DID', (v) => (v['author'] = { handle: 'alice.openreel.social' })],
    ['zero duration', (v) => (v['durationMs'] = 0)],
    ['malformed indexedAt', (v) => (v['indexedAt'] = 'yesterday')],
  ])('rejects a post view with %s', (_name, mutate) => {
    const view = postView() as unknown as Record<string, unknown>
    mutate(view)
    expect(() => lexicons.assertValidXrpcOutput(nsid, { feed: [view] })).toThrow()
  })
})
