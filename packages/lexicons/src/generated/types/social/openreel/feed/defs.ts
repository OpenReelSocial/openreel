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
const id = 'social.openreel.feed.defs'

/** A feed a client can offer the viewer, with its ranking method disclosed. Mirrors the social.openreel.feed.generator record, plus the AT-URI to pass to getFeed and, for weighted feeds, the weights applied. */
export interface GeneratorView {
  $type?: 'social.openreel.feed.defs#generatorView'
  /** AT-URI of the social.openreel.feed.generator record; the 'feed' parameter of getFeed. */
  uri: string
  displayName: string
  description?: string
  /** Self-declared family of ranking method; see social.openreel.feed.generator. */
  rankingCriteria:
    | 'chronological'
    | 'heuristic'
    | 'social'
    | 'personalized'
    | 'collaborative'
    | 'hybrid'
    | (string & {})
  /** The signals a weighted feed scores posts by and how much each counts. Absent for feeds that are not a weighted sum, such as chronological ones. */
  weights?: RankingWeight[]
}

const hashGeneratorView = 'generatorView'

export function isGeneratorView<V>(v: V) {
  return is$typed(v, id, hashGeneratorView)
}

export function validateGeneratorView<V>(v: V) {
  return validate<GeneratorView & V>(v, id, hashGeneratorView)
}

/** One term of a weighted feed's score. Each signal is normalized to 0-1 before weighting. */
export interface RankingWeight {
  $type?: 'social.openreel.feed.defs#rankingWeight'
  /** 'views' is a post's view count (indexed social.openreel.engagement.watchEvent records) relative to the most-viewed post; 'recency' decays from 1 by half every halfLifeHours. */
  signal: 'views' | 'recency' | (string & {})
  /** Share of the score in basis points; a feed's weights sum to 10000. */
  weightBps: number
  /** For time-decayed signals such as 'recency': hours for the signal to fall by half. */
  halfLifeHours?: number
}

const hashRankingWeight = 'rankingWeight'

export function isRankingWeight<V>(v: V) {
  return is$typed(v, id, hashRankingWeight)
}

export function validateRankingWeight<V>(v: V) {
  return validate<RankingWeight & V>(v, id, hashRankingWeight)
}
