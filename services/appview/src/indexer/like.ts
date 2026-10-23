import { jsonToLex } from '@atproto/lexicon'
import { ids, lexicons, type SocialOpenreelEngagementLike } from '@openreel/lexicons'

/** The columns the indexer derives from a `social.openreel.engagement.like` record. */
export interface LikeFields {
  subjectUri: string
  subjectCid: string
  createdAt: Date
}

/**
 * Validates a like from the firehose against the Lexicon and extracts the
 * indexed columns, or returns `undefined` for a record that does not conform,
 * or whose subject is not a video post.
 */
export function readLike(json: Record<string, unknown>): LikeFields | undefined {
  let record: SocialOpenreelEngagementLike.Record
  try {
    record = lexicons.assertValidRecord(
      ids.SocialOpenreelEngagementLike,
      jsonToLex(json),
    ) as SocialOpenreelEngagementLike.Record
  } catch {
    return undefined
  }

  const createdAt = new Date(record.createdAt)
  if (Number.isNaN(createdAt.getTime())) return undefined
  if (record.subject.uri.split('/')[3] !== ids.SocialOpenreelVideoPost) return undefined

  return { subjectUri: record.subject.uri, subjectCid: record.subject.cid, createdAt }
}
