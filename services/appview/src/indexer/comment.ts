import { jsonToLex } from '@atproto/lexicon'
import { ids, lexicons, type SocialOpenreelVideoComment } from '@openreel/lexicons'

/** The columns the indexer derives from a `social.openreel.video.comment` record. */
export interface CommentFields {
  subjectUri: string
  subjectCid: string
  /** The top-level comment a reply belongs to; `null` for a top-level comment. */
  parentUri: string | null
  text: string
  createdAt: Date
}

/**
 * Validates a comment from the firehose against the Lexicon and extracts the
 * indexed columns, or returns `undefined` for a record that does not conform,
 * whose subject is not a video post, or whose parent is not a comment.
 */
export function readComment(json: Record<string, unknown>): CommentFields | undefined {
  let record: SocialOpenreelVideoComment.Record
  try {
    record = lexicons.assertValidRecord(
      ids.SocialOpenreelVideoComment,
      jsonToLex(json),
    ) as SocialOpenreelVideoComment.Record
  } catch {
    return undefined
  }

  const createdAt = new Date(record.createdAt)
  if (Number.isNaN(createdAt.getTime())) return undefined
  if (record.subject.uri.split('/')[3] !== ids.SocialOpenreelVideoPost) return undefined
  if (
    record.parent !== undefined &&
    record.parent.uri.split('/')[3] !== ids.SocialOpenreelVideoComment
  ) {
    return undefined
  }

  return {
    subjectUri: record.subject.uri,
    subjectCid: record.subject.cid,
    parentUri: record.parent?.uri ?? null,
    text: record.text,
    createdAt,
  }
}
