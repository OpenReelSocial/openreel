// Contract tests: representative valid values pass, representative invalid
// values fail, through both the runtime collection and the generated helpers.
// Extend the invalid-case tables when a Lexicon gains constraints.

import { jsonToLex, lexToJson } from '@atproto/lexicon'
import { describe, expect, it } from 'vitest'

import {
  SocialOpenreelEngagementCompletionRate,
  SocialOpenreelEngagementWatchEvent,
  SocialOpenreelFeedGenerator,
  SocialOpenreelVideoPost,
  ids,
  lexicons,
} from '../src/index.ts'
import {
  blob,
  completionRate,
  feedGenerator,
  sampleCid,
  videoPost,
  watchEvent,
} from './fixtures.ts'

type Mutation = [name: string, mutate: (record: Record<string, unknown>) => void]

const badDatetime: Mutation = [
  'malformed createdAt',
  (r) => {
    r['createdAt'] = '2026-09-15 12:00'
  },
]

function expectRejected(nsid: string, record: Record<string, unknown>) {
  expect(() => lexicons.assertValidRecord(nsid, record)).toThrow()
}

describe(ids.SocialOpenreelVideoPost, () => {
  const nsid = ids.SocialOpenreelVideoPost

  it('accepts a fully populated post', () => {
    expect(() => lexicons.assertValidRecord(nsid, videoPost())).not.toThrow()
    expect(SocialOpenreelVideoPost.validateRecord(videoPost()).success).toBe(true)
    expect(SocialOpenreelVideoPost.isRecord(videoPost())).toBe(true)
  })

  it('accepts a post with only the required fields', () => {
    const minimal = {
      $type: nsid,
      video: blob('video/quicktime'),
      durationMs: 1,
      createdAt: '2026-09-15T12:00:00Z',
    }
    expect(() => lexicons.assertValidRecord(nsid, minimal)).not.toThrow()
  })

  it('declares blob constraints for the PDS to enforce at upload time', () => {
    // @atproto/lexicon only checks that a blob field holds a BlobRef; accept and
    // maxSize are enforced by the PDS when the blob is uploaded, so they are
    // asserted on the schema rather than through record validation.
    const record = lexicons.getDefOrThrow(nsid, ['record'])
    const props = record.record.properties
    expect(props['video']).toMatchObject({
      type: 'blob',
      accept: ['video/*'],
      maxSize: 100_000_000,
    })
    expect(props['thumbnail']).toMatchObject({
      type: 'blob',
      accept: ['image/*'],
      maxSize: 1_000_000,
    })
  })

  it('keeps the labels union open to future self-label types', () => {
    const record = videoPost()
    record.labels = { $type: 'social.openreel.future#labels' }
    expect(() => lexicons.assertValidRecord(nsid, record)).not.toThrow()
  })

  it('round-trips through the JSON wire form', () => {
    const wire = lexToJson(videoPost())
    expect(() => lexicons.assertValidRecord(nsid, jsonToLex(wire))).not.toThrow()
  })

  it.each<Mutation>([
    ['missing video', (r) => delete r['video']],
    ['missing durationMs', (r) => delete r['durationMs']],
    ['missing createdAt', (r) => delete r['createdAt']],
    badDatetime,
    ['durationMs as string', (r) => (r['durationMs'] = '1500')],
    ['durationMs of zero', (r) => (r['durationMs'] = 0)],
    ['caption over maxGraphemes', (r) => (r['caption'] = 'x'.repeat(301))],
    ['too many tags', (r) => (r['tags'] = Array.from({ length: 9 }, (_, i) => `t${i}`))],
    ['tag over maxGraphemes', (r) => (r['tags'] = ['x'.repeat(65)])],
    ['aspectRatio with zero height', (r) => (r['aspectRatio'] = { width: 9, height: 0 })],
    ['aspectRatio missing width', (r) => (r['aspectRatio'] = { height: 16 })],
    ['thumbnail that is not a blob ref', (r) => (r['thumbnail'] = { $link: sampleCid })],
    ['langs with an invalid language tag', (r) => (r['langs'] = ['not a language'])],
    ['too many langs', (r) => (r['langs'] = ['en', 'es', 'fr', 'de'])],
    ['labels without a $type', (r) => (r['labels'] = { values: [] })],
    [
      'selfLabels with a val over maxLength',
      (r) =>
        (r['labels'] = {
          $type: 'com.atproto.label.defs#selfLabels',
          values: [{ val: 'x'.repeat(129) }],
        }),
    ],
  ])('rejects %s', (_name, mutate) => {
    const record: Record<string, unknown> = videoPost()
    mutate(record)
    expectRejected(nsid, record)
    expect(SocialOpenreelVideoPost.validateRecord(record).success).toBe(false)
  })
})

describe(ids.SocialOpenreelEngagementWatchEvent, () => {
  const nsid = ids.SocialOpenreelEngagementWatchEvent

  it('accepts a fully populated watch event', () => {
    expect(() => lexicons.assertValidRecord(nsid, watchEvent())).not.toThrow()
    expect(SocialOpenreelEngagementWatchEvent.validateRecord(watchEvent()).success).toBe(true)
  })

  it('accepts a watch longer than the video (rewatches) and an unknown context', () => {
    const record = watchEvent()
    record.watchDurationMs = record.videoDurationMs * 3
    // knownValues is an open set; new surfaces must not break old readers.
    record.context = 'notification'
    expect(() => lexicons.assertValidRecord(nsid, record)).not.toThrow()
  })

  it.each<Mutation>([
    ['missing subject', (r) => delete r['subject']],
    ['subject without cid', (r) => (r['subject'] = { uri: 'at://did:plc:abc/x.y.z/1' })],
    ['subject with a non-AT URI', (r) => (r['subject'] = { uri: 'https://x', cid: 'bafy' })],
    ['missing watchDurationMs', (r) => delete r['watchDurationMs']],
    ['negative watchDurationMs', (r) => (r['watchDurationMs'] = -1)],
    ['missing videoDurationMs', (r) => delete r['videoDurationMs']],
    ['videoDurationMs of zero', (r) => (r['videoDurationMs'] = 0)],
    ['soundEnabled as string', (r) => (r['soundEnabled'] = 'yes')],
    ['negative rewatchCount', (r) => (r['rewatchCount'] = -1)],
    ['context as number', (r) => (r['context'] = 1)],
    ['missing createdAt', (r) => delete r['createdAt']],
    badDatetime,
  ])('rejects %s', (_name, mutate) => {
    const record: Record<string, unknown> = watchEvent()
    mutate(record)
    expectRejected(nsid, record)
    expect(SocialOpenreelEngagementWatchEvent.validateRecord(record).success).toBe(false)
  })
})

describe(ids.SocialOpenreelEngagementCompletionRate, () => {
  const nsid = ids.SocialOpenreelEngagementCompletionRate

  it('is an object definition, not a record type', () => {
    expect(lexicons.getDefOrThrow(nsid).type).toBe('object')
    expect(() => lexicons.assertValidRecord(nsid, completionRate())).toThrow()
  })

  it('accepts a fully populated aggregate, with or without $type', () => {
    expect(SocialOpenreelEngagementCompletionRate.validateMain(completionRate()).success).toBe(true)
    const untyped: Record<string, unknown> = { ...completionRate() }
    delete untyped['$type']
    expect(SocialOpenreelEngagementCompletionRate.validateMain(untyped).success).toBe(true)
  })

  it.each<Mutation>([
    ['missing subject', (r) => delete r['subject']],
    ['subject that is not an AT URI', (r) => (r['subject'] = 'https://openreel.social')],
    ['missing totalViews', (r) => delete r['totalViews']],
    ['negative totalViews', (r) => (r['totalViews'] = -1)],
    ['missing avgCompletionRateBps', (r) => delete r['avgCompletionRateBps']],
    ['avgCompletionRateBps above 10000', (r) => (r['avgCompletionRateBps'] = 10_001)],
    ['fractional avgCompletionRateBps', (r) => (r['avgCompletionRateBps'] = 81.5)],
    ['likeRatioBps above 10000', (r) => (r['likeRatioBps'] = 10_001)],
    ['missing computedAt', (r) => delete r['computedAt']],
    ['malformed computedAt', (r) => (r['computedAt'] = 'yesterday')],
  ])('rejects %s', (_name, mutate) => {
    const value: Record<string, unknown> = { ...completionRate() }
    mutate(value)
    expect(SocialOpenreelEngagementCompletionRate.validateMain(value).success).toBe(false)
  })
})

describe(ids.SocialOpenreelFeedGenerator, () => {
  const nsid = ids.SocialOpenreelFeedGenerator

  it('accepts a fully populated generator declaration', () => {
    expect(() => lexicons.assertValidRecord(nsid, feedGenerator())).not.toThrow()
    expect(SocialOpenreelFeedGenerator.validateRecord(feedGenerator()).success).toBe(true)
  })

  it('accepts every documented ranking family and unknown future ones', () => {
    for (const criteria of [
      'chronological',
      'heuristic',
      'social',
      'personalized',
      'collaborative',
      'hybrid',
      'something-new',
    ]) {
      const record = feedGenerator()
      record.rankingCriteria = criteria
      expect(() => lexicons.assertValidRecord(nsid, record)).not.toThrow()
    }
  })

  it.each<Mutation>([
    ['missing did', (r) => delete r['did']],
    ['did that is not a DID', (r) => (r['did'] = 'feeds.openreel.social')],
    ['missing displayName', (r) => delete r['displayName']],
    ['displayName over maxGraphemes', (r) => (r['displayName'] = 'x'.repeat(25))],
    ['description over maxGraphemes', (r) => (r['description'] = 'x'.repeat(301))],
    ['avatar that is not a blob ref', (r) => (r['avatar'] = 'https://example.com/a.png')],
    ['missing rankingCriteria', (r) => delete r['rankingCriteria']],
    ['rankingCriteria as array', (r) => (r['rankingCriteria'] = ['heuristic'])],
    ['missing createdAt', (r) => delete r['createdAt']],
    badDatetime,
  ])('rejects %s', (_name, mutate) => {
    const record: Record<string, unknown> = feedGenerator()
    mutate(record)
    expectRejected(nsid, record)
    expect(SocialOpenreelFeedGenerator.validateRecord(record).success).toBe(false)
  })
})
