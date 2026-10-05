import { describe, expect, it } from 'vitest'

import { readVideoPost } from '../src/indexer/video-post.ts'
import { postRecordJson, videoCid } from './fixtures.ts'

describe('readVideoPost', () => {
  it('extracts the indexed columns from a JSON-form record', () => {
    const thumbCid = 'bafkreidgvpkjawlxz6sffxzwgooowe5yt7i6wsyg236mfoks77nywkptdq'
    const fields = readVideoPost(
      postRecordJson({
        aspectRatio: { width: 9, height: 16 },
        thumbnail: { $type: 'blob', ref: { $link: thumbCid }, mimeType: 'image/jpeg', size: 10 },
      }),
    )

    expect(fields).toEqual({
      caption: 'hello from the firehose',
      durationMs: 5_000,
      videoCid,
      thumbnailCid: thumbCid,
      aspectWidth: 9,
      aspectHeight: 16,
      createdAt: new Date('2026-10-01T12:00:00.000Z'),
    })
  })

  it('leaves optional fields null', () => {
    expect(readVideoPost(postRecordJson({ caption: undefined }))).toMatchObject({
      caption: null,
      thumbnailCid: null,
      aspectWidth: null,
    })
  })

  it.each<[string, Record<string, unknown>]>([
    ['missing video', { video: undefined }],
    [
      'non-video blob',
      { video: { $type: 'blob', ref: { $link: videoCid }, mimeType: 1, size: 1 } },
    ],
    ['zero duration', { durationMs: 0 }],
    ['malformed createdAt', { createdAt: 'yesterday' }],
    ['wrong $type', { $type: 'app.bsky.feed.post' }],
  ])('rejects a record with %s', (_name, overrides) => {
    const json = postRecordJson(overrides)
    for (const [k, v] of Object.entries(overrides)) if (v === undefined) delete json[k]
    expect(readVideoPost(json)).toBeUndefined()
  })
})
