import type { Database } from '@openreel/db'
import type { AtprotoIdentity } from '@openreel/service-core'
import type { Kysely } from 'kysely'

import type { AccountEvent, CommitEvent, IdentityEvent, JetstreamEvent } from './events.ts'
import { readVideoPost } from './video-post.ts'

export const VIDEO_POST_COLLECTION = 'social.openreel.video.post'

/** Account statuses whose content must no longer be served. */
const REMOVED_STATUSES = new Set(['deleted', 'takendown'])

export interface IdentityResolver {
  resolve(did: string): Promise<AtprotoIdentity>
}

/**
 * Writes firehose events into the AppView index. Every operation is an
 * idempotent upsert or delete, so replaying events after a restart (the cursor
 * is saved periodically, not per event) converges on the same state.
 */
export class Indexer {
  readonly #db: Kysely<Database>
  readonly #identity: IdentityResolver

  constructor(db: Kysely<Database>, identity: IdentityResolver) {
    this.#db = db
    this.#identity = identity
  }

  async handle(event: JetstreamEvent): Promise<void> {
    switch (event.kind) {
      case 'commit':
        if (event.commit.collection === VIDEO_POST_COLLECTION) await this.#videoPost(event)
        return
      case 'identity':
        await this.#identityChanged(event)
        return
      case 'account':
        await this.#accountChanged(event)
        return
    }
  }

  async #videoPost(event: CommitEvent): Promise<void> {
    const uri = `at://${event.did}/${event.commit.collection}/${event.commit.rkey}`

    if (event.commit.operation === 'delete') {
      await this.#db.deleteFrom('video_post').where('uri', '=', uri).execute()
      return
    }

    const fields = event.commit.record && readVideoPost(event.commit.record)
    if (fields === undefined || event.commit.cid === undefined) {
      console.warn(`[appview] skipping invalid ${VIDEO_POST_COLLECTION} record ${uri}`)
      return
    }

    await this.#ensureActor(event.did)
    const now = new Date()
    const sortAt = fields.createdAt < now ? fields.createdAt : now
    const columns = {
      cid: event.commit.cid,
      caption: fields.caption,
      duration_ms: fields.durationMs,
      video_cid: fields.videoCid,
      thumbnail_cid: fields.thumbnailCid,
      aspect_width: fields.aspectWidth,
      aspect_height: fields.aspectHeight,
      created_at: fields.createdAt,
      record: JSON.stringify(event.commit.record),
    }

    await this.#db.transaction().execute(async (tx) => {
      await tx
        .insertInto('video_post')
        .values({ uri, author_did: event.did, sort_at: sortAt, ...columns })
        // An edit keeps its original feed position.
        .onConflict((oc) => oc.column('uri').doUpdateSet(columns))
        .execute()
      // Queue the blob for transcoding unless it already has renditions.
      await tx
        .insertInto('video_media')
        .values({ author_did: event.did, video_cid: fields.videoCid })
        .onConflict((oc) => oc.columns(['author_did', 'video_cid']).doNothing())
        .execute()
    })
  }

  async #identityChanged(event: IdentityEvent): Promise<void> {
    const handle = event.identity.handle ?? (await this.#resolveHandle(event.did))
    await this.#db
      .insertInto('actor')
      .values({ did: event.did, handle })
      .onConflict((oc) => oc.column('did').doUpdateSet({ handle }))
      .execute()
  }

  async #accountChanged(event: AccountEvent): Promise<void> {
    const { active, status } = event.account
    if (active || status === undefined || !REMOVED_STATUSES.has(status)) return
    await this.#db.deleteFrom('video_post').where('author_did', '=', event.did).execute()
  }

  /** Inserts an actor row the first time a DID is seen, resolving its handle. */
  async #ensureActor(did: string): Promise<void> {
    const existing = await this.#db
      .selectFrom('actor')
      .select('did')
      .where('did', '=', did)
      .executeTakeFirst()
    if (existing !== undefined) return

    const handle = await this.#resolveHandle(did)
    await this.#db
      .insertInto('actor')
      .values({ did, handle })
      .onConflict((oc) => oc.column('did').doNothing())
      .execute()
  }

  async #resolveHandle(did: string): Promise<string | null> {
    try {
      return (await this.#identity.resolve(did)).handle ?? null
    } catch (error) {
      // Index the content anyway; a later identity event fills the handle in.
      console.warn(`[appview] could not resolve ${did}: ${(error as Error).message}`)
      return null
    }
  }
}
