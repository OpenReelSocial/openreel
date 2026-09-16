/**
 * GENERATED CODE - DO NOT MODIFY
 */
import { type ValidationResult, BlobRef } from '@atproto/lexicon'
import { CID } from 'multiformats/cid'
import { validate as _validate } from '../../../../lexicons.js'
import {
  type $Typed,
  is$typed as _is$typed,
  type OmitKey,
} from '../../../../util.js'

const is$typed = _is$typed,
  validate = _validate
const id = 'social.openreel.engagement.completionRate'

/** Anonymized aggregate engagement for one video, computed by an indexing service from many watch events and published to feed generators. This is a derived value returned by services, not a record stored in user repositories. Lexicon has no floating-point type, so ratios are expressed in basis points (1/100 of a percent, 0-10000). */
export interface Main {
  $type?: 'social.openreel.engagement.completionRate'
  /** AT-URI of the social.openreel.video.post the aggregate describes. */
  subject: string
  /** Number of watch events included in the aggregate. Publishers should withhold aggregates below their anonymity threshold. */
  totalViews: number
  /** Mean of min(watchDurationMs / videoDurationMs, 1) across included watch events, in basis points. */
  avgCompletionRateBps: number
  /** Likes divided by totalViews, in basis points. */
  likeRatioBps?: number
  /** When the aggregate was computed. */
  computedAt: string
}

const hashMain = 'main'

export function isMain<V>(v: V) {
  return is$typed(v, id, hashMain)
}

export function validateMain<V>(v: V) {
  return validate<Main & V>(v, id, hashMain)
}
