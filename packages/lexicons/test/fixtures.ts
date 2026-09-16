// Representative valid values for every OpenReel Lexicon. Tests derive invalid
// cases from these, so keep each fixture minimal-but-complete.

import { BlobRef } from '@atproto/lexicon'
import { CID } from 'multiformats/cid'

import type {
  SocialOpenreelEngagementCompletionRate,
  SocialOpenreelEngagementWatchEvent,
  SocialOpenreelFeedGenerator,
  SocialOpenreelVideoPost,
} from '../src/index.ts'

export const sampleCid = 'bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku'
export const sampleDid = 'did:plc:ewvi7nxzyoun6zhxrhs64oiz'
export const samplePostUri = `at://${sampleDid}/social.openreel.video.post/3kbc7ijcn5m2u`

export function blob(mimeType: string, size = 1024): BlobRef {
  return new BlobRef(CID.parse(sampleCid), mimeType, size)
}

export function videoPost(): SocialOpenreelVideoPost.Record {
  return {
    $type: 'social.openreel.video.post',
    video: blob('video/mp4', 8_000_000),
    caption: 'First upload from the iOS client',
    tags: ['openreel', 'atproto'],
    durationMs: 15_250,
    aspectRatio: { width: 9, height: 16 },
    thumbnail: blob('image/jpeg', 120_000),
    alt: 'A skateboarder lands a kickflip at sunset.',
    langs: ['en'],
    labels: {
      $type: 'com.atproto.label.defs#selfLabels',
      values: [{ val: 'graphic-media' }],
    },
    createdAt: '2026-09-15T12:00:00.000Z',
  }
}

export function watchEvent(): SocialOpenreelEngagementWatchEvent.Record {
  return {
    $type: 'social.openreel.engagement.watchEvent',
    subject: { uri: samplePostUri, cid: sampleCid },
    watchDurationMs: 21_000,
    videoDurationMs: 15_250,
    soundEnabled: true,
    rewatchCount: 1,
    context: 'feed',
    createdAt: '2026-09-15T12:05:00.000Z',
  }
}

export function completionRate(): SocialOpenreelEngagementCompletionRate.Main {
  return {
    $type: 'social.openreel.engagement.completionRate',
    subject: samplePostUri,
    totalViews: 1_204,
    avgCompletionRateBps: 8_150,
    likeRatioBps: 620,
    computedAt: '2026-09-15T13:00:00.000Z',
  }
}

export function feedGenerator(): SocialOpenreelFeedGenerator.Record {
  return {
    $type: 'social.openreel.feed.generator',
    did: 'did:web:feeds.openreel.social',
    displayName: 'Trending',
    description: 'Ranks recent videos by completion rate, like ratio, and recency.',
    avatar: blob('image/png', 40_000),
    rankingCriteria: 'heuristic',
    createdAt: '2026-09-15T12:00:00.000Z',
  }
}
