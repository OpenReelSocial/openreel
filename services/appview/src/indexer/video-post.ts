import { jsonToLex } from '@atproto/lexicon'
import { ids, lexicons, type SocialOpenreelVideoPost } from '@openreel/lexicons'

/** The columns the indexer derives from a `social.openreel.video.post` record. */
export interface VideoPostFields {
  caption: string | null
  durationMs: number
  videoCid: string
  thumbnailCid: string | null
  aspectWidth: number | null
  aspectHeight: number | null
  createdAt: Date
}

/**
 * Validates a record from the firehose against the Lexicon and extracts the
 * indexed columns, or returns `undefined` for a record that does not conform.
 * Jetstream delivers records in their JSON form (`$link`, `$bytes`), which is
 * converted to the in-memory form the validator expects.
 */
export function readVideoPost(json: Record<string, unknown>): VideoPostFields | undefined {
  let record: SocialOpenreelVideoPost.Record
  try {
    record = lexicons.assertValidRecord(
      ids.SocialOpenreelVideoPost,
      jsonToLex(json),
    ) as SocialOpenreelVideoPost.Record
  } catch {
    return undefined
  }

  const createdAt = new Date(record.createdAt)
  if (Number.isNaN(createdAt.getTime())) return undefined

  return {
    caption: record.caption ?? null,
    durationMs: record.durationMs,
    videoCid: record.video.ref.toString(),
    thumbnailCid: record.thumbnail?.ref.toString() ?? null,
    aspectWidth: record.aspectRatio?.width ?? null,
    aspectHeight: record.aspectRatio?.height ?? null,
    createdAt,
  }
}
