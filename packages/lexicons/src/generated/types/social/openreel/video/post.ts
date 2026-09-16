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
import type * as ComAtprotoLabelDefs from '../../../com/atproto/label/defs.js'

const is$typed = _is$typed,
  validate = _validate
const id = 'social.openreel.video.post'

export interface Main {
  $type: 'social.openreel.video.post'
  /** The source video as uploaded by the author. */
  video: BlobRef
  /** Author-written caption shown with the video. */
  caption?: string
  /** Hashtags without the leading '#', used for discovery. */
  tags?: string[]
  /** Duration of the video in milliseconds, as measured by the client at upload time. */
  durationMs: number
  aspectRatio?: AspectRatio
  /** Poster image displayed before playback starts. */
  thumbnail?: BlobRef
  /** Alt text describing the video for accessibility. */
  alt?: string
  /** Languages spoken or captioned in the video, as BCP-47 tags. */
  langs?: string[]
  labels?: $Typed<ComAtprotoLabelDefs.SelfLabels> | { $type: string }
  /** Client-declared timestamp when the post was created. */
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

/** Display aspect ratio as a width:height pair. Only the ratio is meaningful; the values are not pixel dimensions. */
export interface AspectRatio {
  $type?: 'social.openreel.video.post#aspectRatio'
  width: number
  height: number
}

const hashAspectRatio = 'aspectRatio'

export function isAspectRatio<V>(v: V) {
  return is$typed(v, id, hashAspectRatio)
}

export function validateAspectRatio<V>(v: V) {
  return validate<AspectRatio & V>(v, id, hashAspectRatio)
}
