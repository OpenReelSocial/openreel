import { jsonToLex } from '@atproto/lexicon'
import { ids, lexicons, type SocialOpenreelEngagementWatchEvent } from '@openreel/lexicons'

/** The columns the indexer derives from a `social.openreel.engagement.watchEvent` record. */
export interface WatchEventFields {
  subjectUri: string
  subjectCid: string
  watchDurationMs: number
  /** Fraction of the video watched, capped at 1 when rewatches push it past. */
  completionRate: number
  soundEnabled: boolean | null
  rewatchCount: number | null
  createdAt: Date
}

/**
 * Validates a watch event from the firehose against the Lexicon and extracts
 * the indexed columns, or returns `undefined` for a record that does not
 * conform, or whose subject is not a video post.
 */
export function readWatchEvent(json: Record<string, unknown>): WatchEventFields | undefined {
  let record: SocialOpenreelEngagementWatchEvent.Record
  try {
    record = lexicons.assertValidRecord(
      ids.SocialOpenreelEngagementWatchEvent,
      jsonToLex(json),
    ) as SocialOpenreelEngagementWatchEvent.Record
  } catch {
    return undefined
  }

  const createdAt = new Date(record.createdAt)
  if (Number.isNaN(createdAt.getTime())) return undefined
  if (record.subject.uri.split('/')[3] !== ids.SocialOpenreelVideoPost) return undefined

  return {
    subjectUri: record.subject.uri,
    subjectCid: record.subject.cid,
    watchDurationMs: record.watchDurationMs,
    completionRate: Math.min(1, record.watchDurationMs / record.videoDurationMs),
    soundEnabled: record.soundEnabled ?? null,
    rewatchCount: record.rewatchCount ?? null,
    createdAt,
  }
}
