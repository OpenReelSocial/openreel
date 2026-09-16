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
import type * as ComAtprotoRepoStrongRef from '../../../com/atproto/repo/strongRef.js'

const is$typed = _is$typed,
  validate = _validate
const id = 'social.openreel.engagement.watchEvent'

export interface Main {
  $type: 'social.openreel.engagement.watchEvent'
  subject: ComAtprotoRepoStrongRef.Main
  /** Total milliseconds of playback across the session, including any rewatches. May exceed videoDurationMs. */
  watchDurationMs: number
  /** Duration of the video in milliseconds at the time it was watched, so completion can be derived without hydrating the post. */
  videoDurationMs: number
  /** Whether audio was unmuted for at least part of the session. */
  soundEnabled?: boolean
  /** Number of times playback looped or was restarted within the session. Zero for a single pass. */
  rewatchCount?: number
  /** Surface the video was watched from. */
  context?: 'feed' | 'profile' | 'search' | 'direct' | (string & {})
  /** Client-declared timestamp when the watch session ended. */
  createdAt: string
  [k: string]: unknown
}

const hashMain = 'main'

export function isMain<V>(v: V) {
  return is$typed(v, id, hashMain)
}

export function validateMain<V>(v: V) {
  return validate<Main & V>(v, id, hashMain, true)
}

export {
  type Main as Record,
  isMain as isRecord,
  validateMain as validateRecord,
}
