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
const id = 'social.openreel.feed.generator'

export interface Main {
  $type: 'social.openreel.feed.generator'
  /** DID of the service that serves this feed. */
  did: string
  displayName: string
  description?: string
  avatar?: BlobRef
  /** Self-declared family of ranking method. 'chronological' and 'heuristic' use no individual data; 'social' uses the public follow graph; 'personalized' and 'collaborative' require opted-in engagement data; 'hybrid' combines families. */
  rankingCriteria:
    | 'chronological'
    | 'heuristic'
    | 'social'
    | 'personalized'
    | 'collaborative'
    | 'hybrid'
    | (string & {})
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
