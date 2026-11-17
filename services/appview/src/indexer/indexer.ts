import { purpose, traceStep, type Database } from '@openreel/db'
import type { AtprotoIdentity } from '@openreel/service-core'
import { sql, type Kysely } from 'kysely'

import { readComment } from './comment.ts'
import type { AccountEvent, CommitEvent, IdentityEvent, JetstreamEvent } from './events.ts'
import { readLike } from './like.ts'
import { readVideoPost } from './video-post.ts'
import { readWatchEvent } from './watch-event.ts'

export const VIDEO_POST_COLLECTION = 'social.openreel.video.post'
export const WATCH_EVENT_COLLECTION = 'social.openreel.engagement.watchEvent'
export const LIKE_COLLECTION = 'social.openreel.engagement.like'
export const COMMENT_COLLECTION = 'social.openreel.video.comment'

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
        if (event.commit.operation !== 'delete' && (await this.#isTakenDown(event))) return
        if (event.commit.collection === VIDEO_POST_COLLECTION) await this.#videoPost(event)
        else if (event.commit.collection === WATCH_EVENT_COLLECTION) await this.#watchEvent(event)
        else if (event.commit.collection === LIKE_COLLECTION) await this.#like(event)
        else if (event.commit.collection === COMMENT_COLLECTION) await this.#comment(event)
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
      await this.#db.transaction().execute(async (tx) => {
        const deleted = await purpose('Delete video post', () =>
          tx.deleteFrom('video_post').where('uri', '=', uri).returning('video_cid').execute(),
        )
        await releaseMedia(
          tx,
          event.did,
          deleted.flatMap((row) => (row.video_cid === null ? [] : [row.video_cid])),
        )
      })
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
      // Queue the blob for transcoding unless it already has renditions. A
      // blob whose renditions are being removed is transcoded again.
      await purpose('Enqueue transcode job', () =>
        tx
          .insertInto('video_media')
          .values({ author_did: event.did, video_cid: fields.videoCid })
          .onConflict((oc) =>
            oc
              .columns(['author_did', 'video_cid'])
              .doUpdateSet({
                status: 'pending',
                attempts: 0,
                claimed_at: null,
                last_error: null,
                updated_at: new Date(),
              })
              .where('video_media.status', '=', 'removing'),
          )
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

  async #comment(event: CommitEvent): Promise<void> {
    const uri = `at://${event.did}/${event.commit.collection}/${event.commit.rkey}`
    const remove = async (tx: Kysely<Database>): Promise<void> => {
      // Replies go with it (foreign key cascade); they share its video.
      const deleted = await purpose('Delete comment and its replies', () =>
        tx.deleteFrom('video_comment').where('uri', '=', uri).returning('subject_uri').execute(),
      )
      await refreshStats(
        tx,
        deleted.map((row) => row.subject_uri),
      )
    }

    if (event.commit.operation === 'delete') {
      await this.#db.transaction().execute(remove)
      return
    }

    const fields = event.commit.record && readComment(event.commit.record)
    if (fields === undefined || event.commit.cid === undefined) {
      console.warn(`[appview] skipping invalid ${COMMENT_COLLECTION} record ${uri}`)
      return
    }
    const cid = event.commit.cid

    await this.#ensureActor(event.did)
    await this.#db.transaction().execute(async (tx) => {
      const subject = await purpose('Look up commented video', () =>
        tx
          .selectFrom('video_post')
          .select('uri')
          .where('uri', '=', fields.subjectUri)
          .executeTakeFirst(),
      )
      // A reply must point at a top-level comment on the same video.
      const parent =
        fields.parentUri === null || fields.parentUri === uri
          ? undefined
          : await purpose('Look up parent comment', () =>
              tx
                .selectFrom('video_comment')
                .select('uri')
                .where('uri', '=', fields.parentUri)
                .where('subject_uri', '=', fields.subjectUri)
                .where('parent_uri', 'is', null)
                .executeTakeFirst(),
            )
      if (subject === undefined || (fields.parentUri !== null && parent === undefined)) {
        // An edit can make an indexed comment inadmissible; drop it then too.
        console.warn(`[appview] skipping ${COMMENT_COLLECTION} ${uri}: video or parent not indexed`)
        await remove(tx)
        return
      }

      const previous = await purpose('Fetch previous version of comment', () =>
        tx
          .selectFrom('video_comment')
          .select('subject_uri')
          .where('uri', '=', uri)
          .executeTakeFirst(),
      )
      if (fields.parentUri !== null) {
        // Threads are one level deep: a comment edited into a reply takes its
        // own replies with it.
        await purpose('Delete replies of comment that became a reply', () =>
          tx.deleteFrom('video_comment').where('parent_uri', '=', uri).execute(),
        )
      }
      const now = new Date()
      const columns = {
        cid,
        subject_uri: fields.subjectUri,
        subject_cid: fields.subjectCid,
        parent_uri: fields.parentUri,
        text: fields.text,
        created_at: fields.createdAt,
        record: JSON.stringify(event.commit.record),
      }
      await purpose('Upsert comment', () =>
        tx
          .insertInto('video_comment')
          .values({
            uri,
            author_did: event.did,
            sort_at: fields.createdAt < now ? fields.createdAt : now,
            ...columns,
          })
          // An edit keeps its original position.
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
    await this.#purgeAccount(event.did)
  }

  /**
   * Takes down an account (DID) or a record (AT-URI): deletes what the index
   * holds for it, as if the account were removed or the record deleted, and
   * refuses to index it again. Idempotent.
   */
  async takedown(subject: string, ref: string): Promise<void> {
    await purpose('Record takedown', () =>
      this.#db
        .insertInto('moderation_takedown')
        .values({ subject, ref })
        .onConflict((oc) => oc.column('subject').doUpdateSet({ ref }))
        .execute(),
    )
    if (subject.startsWith('did:')) {
      await this.#purgeAccount(subject)
      return
    }
    const [did, collection, rkey] = subject.slice('at://'.length).split('/')
    if (did === undefined || collection === undefined || rkey === undefined) return
    await this.handle({
      kind: 'commit',
      did,
      time_us: Date.now() * 1000,
      commit: { operation: 'delete', collection, rkey },
    })
  }

  /**
   * Lifts a takedown so the subject can be indexed again. What was removed
   * is not restored: a record returns when its author next writes it, or on
   * a replay of the firehose that still includes it.
   */
  async liftTakedown(subject: string): Promise<void> {
    await purpose('Lift takedown', () =>
      this.#db.deleteFrom('moderation_takedown').where('subject', '=', subject).execute(),
    )
  }

  /** The takedown ref for a subject, or `undefined` if it is not taken down. */
  async takedownRef(subject: string): Promise<string | undefined> {
    const row = await purpose('Look up takedown', () =>
      this.#db
        .selectFrom('moderation_takedown')
        .select('ref')
        .where('subject', '=', subject)
        .executeTakeFirst(),
    )
    return row?.ref
  }

  async #isTakenDown(event: CommitEvent): Promise<boolean> {
    const uri = `at://${event.did}/${event.commit.collection}/${event.commit.rkey}`
    const row = await purpose('Check takedowns', () =>
      this.#db
        .selectFrom('moderation_takedown')
        .select('subject')
        .where('subject', 'in', [event.did, uri])
        .executeTakeFirst(),
    )
    return row !== undefined
  }

  async #purgeAccount(did: string): Promise<void> {
    await purpose('Purge content of removed account', () =>
      this.#db.transaction().execute(async (tx) => {
        // Comments on the account's videos go with them (foreign key cascade).
        const posts = await tx
          .deleteFrom('video_post')
          .where('author_did', '=', did)
          .returning('video_cid')
          .execute()
        await releaseMedia(
          tx,
          did,
          posts.flatMap((row) => (row.video_cid === null ? [] : [row.video_cid])),
        )
        const commented = await tx
          .deleteFrom('video_comment')
          .where('author_did', '=', did)
          .returning('subject_uri')
          .execute()
        const watched = await tx
          .deleteFrom('watch_event')
          .where('actor_did', '=', did)
          .returning('subject_uri')
          .execute()
        const liked = await tx
          .deleteFrom('video_like')
          .where('actor_did', '=', did)
          .returning('subject_uri')
          .execute()
        await refreshStats(
          tx,
          [...watched, ...liked, ...commented].map((row) => row.subject_uri),
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
 * Queues renditions of an author's blobs for removal once no indexed post uses
 * them: two posts can share an upload, and the renditions stay until the last
 * one goes. The media service deletes them from storage and the CDN.
 */
async function releaseMedia(db: Kysely<Database>, did: string, videoCids: string[]): Promise<void> {
  if (videoCids.length === 0) return
  await purpose('Queue renditions of unused blobs for removal', () =>
    db
      .updateTable('video_media as m')
      .set({ status: 'removing', claimed_at: null, updated_at: new Date() })
      .where('m.author_did', '=', did)
      .where('m.video_cid', 'in', [...new Set(videoCids)])
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('video_post as p')
              .select('p.uri')
              .whereRef('p.author_did', '=', 'm.author_did')
              .whereRef('p.video_cid', '=', 'm.video_cid'),
          ),
        ),
      )
      .execute(),
  )
}

/**
 * Recomputes `video_post_stats` for each post from its indexed watch events,
 * likes, and comments. Counting rather than incrementing keeps replays idempotent:
 * indexing the same event twice leaves the same numbers. Posts that are not
 * indexed are skipped (the stats row references the post); indexing the post
 * recounts it.
 */
async function refreshStats(db: Kysely<Database>, uris: string[]): Promise<void> {
  const unique = [...new Set(uris)]
  if (unique.length === 0) return
  const query = db
    .insertInto('video_post_stats')
    .columns([
      'uri',
      'view_count',
      'avg_completion_rate',
      'like_count',
      'comment_count',
      'updated_at',
    ])
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
          (eb) =>
            eb
              .selectFrom('video_comment as c')
              .select((c) => c.fn.countAll<number>().as('n'))
              .whereRef('c.subject_uri', '=', 'p.uri')
              .as('comment_count'),
          sql<Date>`now()`.as('updated_at'),
        ])
        .where('p.uri', 'in', unique),
    )
    .onConflict((oc) =>
      oc.column('uri').doUpdateSet((eb) => ({
        view_count: eb.ref('excluded.view_count'),
        avg_completion_rate: eb.ref('excluded.avg_completion_rate'),
        like_count: eb.ref('excluded.like_count'),
        comment_count: eb.ref('excluded.comment_count'),
        updated_at: eb.ref('excluded.updated_at'),
      })),
    )
  await purpose('Recompute post stats (views, likes, comments)', () => query.execute())
}
