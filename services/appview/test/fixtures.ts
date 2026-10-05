import { createDb } from '@openreel/db'

import type { AppViewDeps } from '../src/app.ts'
import type { SkeletonSource } from '../src/skeleton.ts'

export const did = 'did:plc:ri7muaelw3trwgd2eda7tuf2'
export const videoCid = 'bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku'
export const recordCid = 'bafyreih3fl4ddihebc5fk7lbxqnpfpmnqfyzfqyhqcpfzkzr4lh6arqvfu'
export const feedUri = 'at://openreel.social/social.openreel.feed.generator/recent'

export function postUri(rkey: string): string {
  return `at://${did}/social.openreel.video.post/${rkey}`
}

/** A valid record in the JSON form Jetstream delivers. */
export function postRecordJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    $type: 'social.openreel.video.post',
    video: { $type: 'blob', ref: { $link: videoCid }, mimeType: 'video/mp4', size: 1_000_000 },
    caption: 'hello from the firehose',
    durationMs: 5_000,
    createdAt: '2026-10-01T12:00:00.000Z',
    ...overrides,
  }
}

/** A database handle that never connects; for paths that must not query. */
export function unusedDb(): AppViewDeps['db'] {
  return createDb('postgres://nobody:nothing@203.0.113.1:1/none')
}

export function deps(skeleton: SkeletonSource, db = unusedDb()): AppViewDeps {
  return { db, skeleton, defaultFeedUri: feedUri, mediaPublicUrl: 'https://media.test' }
}
