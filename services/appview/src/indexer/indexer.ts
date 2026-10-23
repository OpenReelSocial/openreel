import { purpose, traceStep, type Database } from '@openreel/db'
import type { AtprotoIdentity } from '@openreel/service-core'
import { sql, type Kysely } from 'kysely'

import type { AccountEvent, CommitEvent, IdentityEvent, JetstreamEvent } from './events.ts'
import { readLike } from './like.ts'
import { readVideoPost } from './video-post.ts'
import { readWatchEvent } from './watch-event.ts'

export const VIDEO_POST_COLLECTION = 'social.openreel.video.post'
export const WATCH_EVENT_COLLECTION = 'social.openreel.engagement.watchEvent'
export const LIKE_COLLECTION = 'social.openreel.engagement.like'

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
        else if (event.commit.collection === WATCH_EVENT_COLLECTION) await this.#watchEvent(event)
        else if (event.commit.collection === LIKE_COLLECTION) await this.#like(event)
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
      await purpose('Delete video post', () =>
        this.#db.deleteFrom('video_post').where('uri', '=', uri).execute(),
      )
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
      await purpose('Upsert video post', () =>
        tx
          .insertInto('video_post')
          .values({ uri, author_did: event.did, sort_at: sortAt, ...columns })
          // An edit keeps its original feed position.
          .onConflict((oc) => oc.column('uri').doUpdateSet(columns))
          .execute(),
      )
      // Queue the blob for transcoding unless it already has renditions.
      await purpose('Enqueue transcode job', () =>
        tx
          .insertInto('video_media')
          .values({ author_did: event.did, video_cid: fields.videoCid })
          .onConflict((oc) => oc.columns(['author_did', 'video_cid']).doNothing())
          .execute(),
      )
      // Watch events and likes can be indexed before their post; count them now.
      await refreshStats(tx, [uri])
    })
  }

  async #watchEvent(event: CommitEvent): Promise<void> {
    const uri = `at://${event.did}/${event.commit.collection}/${event.commit.rkey}`

    if (event.commit.operation === 'delete') {
      await this.#db.transaction().execute(async (tx) => {
        const deleted = await purpose('Delete watch event', () =>
          tx.deleteFrom('watch_event').where('uri', '=', uri).returning('subject_uri').execute(),
        )
        await refreshStats(
          tx,
          deleted.map((row) => row.subject_uri),
        )
      })
      return
    }

    const fields = event.commit.record && readWatchEvent(event.commit.record)
    if (fields === undefined || event.commit.cid === undefined) {
      console.warn(`[appview] skipping invalid ${WATCH_EVENT_COLLECTION} record ${uri}`)
      return
    }

    await this.#ensureActor(event.did)
    const columns = {
      cid: event.commit.cid,
      subject_uri: fields.subjectUri,
      subject_cid: fields.subjectCid,
      watch_duration_ms: fields.watchDurationMs,
      completion_rate: fields.completionRate,
      sound_enabled: fields.soundEnabled,
      rewatch_count: fields.rewatchCount,
      created_at: fields.createdAt,
    }

    await this.#db.transaction().execute(async (tx) => {
      // An edit could point the event at another post; recount the old one too.
      const previous = await purpose('Fetch previous version of watch event', () =>
        tx
          .selectFrom('watch_event')
          .select('subject_uri')
          .where('uri', '=', uri)
          .executeTakeFirst(),
      )
      await purpose('Upsert watch event', () =>
        tx
          .insertInto('watch_event')
          .values({ uri, actor_did: event.did, ...columns })
          .onConflict((oc) => oc.column('uri').doUpdateSet(columns))
          .execute(),
      )
      await refreshStats(tx, [fields.subjectUri, ...(previous ? [previous.subject_uri] : [])])
    })
  }

  async #like(event: CommitEvent): Promise<void> {
    const uri = `at://${event.did}/${event.commit.collection}/${event.commit.rkey}`

    if (event.commit.operation === 'delete') {
      await this.#db.transaction().execute(async (tx) => {
        const deleted = await purpose('Delete like', () =>
          tx.deleteFrom('video_like').where('uri', '=', uri).returning('subject_uri').execute(),
        )
        await refreshStats(
          tx,
          deleted.map((row) => row.subject_uri),
        )
      })
      return
    }

    const fields = event.commit.record && readLike(event.commit.record)
    if (fields === undefined || event.commit.cid === undefined) {
      console.warn(`[appview] skipping invalid ${LIKE_COLLECTION} record ${uri}`)
      return
    }

    await this.#ensureActor(event.did)
    const columns = {
      cid: event.commit.cid,
      subject_uri: fields.subjectUri,
      subject_cid: fields.subjectCid,
      created_at: fields.createdAt,
    }

    await this.#db.transaction().execute(async (tx) => {
      // An edit could point the like at another post; recount the old one too.
      const previous = await purpose('Fetch previous version of like', () =>
        tx.selectFrom('video_like').select('subject_uri').where('uri', '=', uri).executeTakeFirst(),
      )
      await purpose('Upsert like', () =>
        tx
          .insertInto('video_like')
          .values({ uri, actor_did: event.did, ...columns })
          .onConflict((oc) => oc.column('uri').doUpdateSet(columns))
          .execute(),
      )
      await refreshStats(tx, [fields.subjectUri, ...(previous ? [previous.subject_uri] : [])])
    })
  }

  async #identityChanged(event: IdentityEvent): Promise<void> {
    const handle = event.identity.handle ?? (await this.#resolveHandle(event.did))
    await purpose('Update actor handle', () =>
      this.#db
        .insertInto('actor')
        .values({ did: event.did, handle })
        .onConflict((oc) => oc.column('did').doUpdateSet({ handle }))
        .execute(),
    )
  }

  async #accountChanged(event: AccountEvent): Promise<void> {
    const { active, status } = event.account
    if (active || status === undefined || !REMOVED_STATUSES.has(status)) return
    await purpose('Purge content of removed account', () =>
      this.#db.transaction().execute(async (tx) => {
        await tx.deleteFrom('video_post').where('author_did', '=', event.did).execute()
        const watched = await tx
          .deleteFrom('watch_event')
          .where('actor_did', '=', event.did)
          .returning('subject_uri')
          .execute()
        const liked = await tx
          .deleteFrom('video_like')
          .where('actor_did', '=', event.did)
          .returning('subject_uri')
          .execute()
        await refreshStats(
          tx,
          [...watched, ...liked].map((row) => row.subject_uri),
        )
      }),
    )
  }

  /** Inserts an actor row the first time a DID is seen, resolving its handle. */
  async #ensureActor(did: string): Promise<void> {
    const existing = await purpose('Look up actor by DID', () =>
      this.#db.selectFrom('actor').select('did').where('did', '=', did).executeTakeFirst(),
    )
    if (existing !== undefined) return

    const handle = await this.#resolveHandle(did)
    await purpose('Insert new actor', () =>
      this.#db
        .insertInto('actor')
        .values({ did, handle })
        .onConflict((oc) => oc.column('did').doNothing())
        .execute(),
    )
  }

  async #resolveHandle(did: string): Promise<string | null> {
    try {
      const identity = await traceStep(
        'Resolve DID document via PLC',
        { kind: 'call', target: 'plc', method: 'GET', path: `/${did}` },
        () => this.#identity.resolve(did),
      )
      return identity.handle ?? null
    } catch (error) {
      // Index the content anyway; a later identity event fills the handle in.
      console.warn(`[appview] could not resolve ${did}: ${(error as Error).message}`)
      return null
    }
  }
}

/**
 * Recomputes `video_post_stats` for each post from its indexed watch events
 * and likes. Counting rather than incrementing keeps replays idempotent:
 * indexing the same event twice leaves the same numbers. Posts that are not
 * indexed are skipped (the stats row references the post); indexing the post
 * recounts it.
 */
async function refreshStats(db: Kysely<Database>, uris: string[]): Promise<void> {
  const unique = [...new Set(uris)]
  if (unique.length === 0) return
  const query = db
    .insertInto('video_post_stats')
    .columns(['uri', 'view_count', 'avg_completion_rate', 'like_count', 'updated_at'])
    .expression(
      db
        .selectFrom('video_post as p')
        .select([
          'p.uri',
          (eb) =>
            eb
              .selectFrom('watch_event as w')
              .select((w) => w.fn.countAll<number>().as('n'))
              .whereRef('w.subject_uri', '=', 'p.uri')
              .as('view_count'),
          (eb) =>
            eb
              .selectFrom('watch_event as w')
              .select((w) => w.fn.avg<number>('w.completion_rate').as('avg'))
              .whereRef('w.subject_uri', '=', 'p.uri')
              .as('avg_completion_rate'),
          // Distinct likers: an account that wrote two likes of a post counts once.
          (eb) =>
            eb
              .selectFrom('video_like as l')
              .select(sql<number>`count(distinct l.actor_did)`.as('n'))
              .whereRef('l.subject_uri', '=', 'p.uri')
              .as('like_count'),
          sql<Date>`now()`.as('updated_at'),
        ])
        .where('p.uri', 'in', unique),
    )
    .onConflict((oc) =>
      oc.column('uri').doUpdateSet((eb) => ({
        view_count: eb.ref('excluded.view_count'),
        avg_completion_rate: eb.ref('excluded.avg_completion_rate'),
        like_count: eb.ref('excluded.like_count'),
        updated_at: eb.ref('excluded.updated_at'),
      })),
    )
  await purpose('Recompute post stats (views, likes)', () => query.execute())
}
