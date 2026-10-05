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
import type * as SocialOpenreelVideoPost from './post.js'

const is$typed = _is$typed,
  validate = _validate
const id = 'social.openreel.video.defs'

/** A video post hydrated by an AppView: the author's record plus derived, playable media. 'playlist' and 'thumbnail' point at renditions the AppView's media pipeline produced from the record's video blob; they are not part of the record. */
export interface PostView {
  $type?: 'social.openreel.video.defs#postView'
  uri: string
  cid: string
  author: AuthorView
  /** The social.openreel.video.post record as stored in the author's repository. */
  record: { [_ in string]: unknown }
  /** HLS multivariant playlist (.m3u8) for the video. */
  playlist: string
  /** Poster image shown before playback starts. */
  thumbnail?: string
  aspectRatio?: SocialOpenreelVideoPost.AspectRatio
  /** Duration of the transcoded video in milliseconds, as measured by the media pipeline. */
  durationMs?: number
  indexedAt: string
}

const hashPostView = 'postView'

export function isPostView<V>(v: V) {
  return is$typed(v, id, hashPostView)
}

export function validatePostView<V>(v: V) {
  return validate<PostView & V>(v, id, hashPostView)
}

export interface AuthorView {
  $type?: 'social.openreel.video.defs#authorView'
  did: string
  /** Handle claimed in the author's DID document, if any. */
  handle?: string
}

const hashAuthorView = 'authorView'

export function isAuthorView<V>(v: V) {
  return is$typed(v, id, hashAuthorView)
}

export function validateAuthorView<V>(v: V) {
  return validate<AuthorView & V>(v, id, hashAuthorView)
}
