import { sql, type Kysely } from 'kysely'

/**
 * Media pipeline: one transcode job per uploaded video blob, a firehose resume
 * cursor for indexers, and the post columns feeds and hydration need.
 *
 * `video_media` is keyed by (author DID, blob CID) rather than by post, because
 * renditions are derived from the blob: two posts reusing one upload share them,
 * and an edited caption does not re-transcode. It doubles as the job queue the
 * media service claims from with `FOR UPDATE SKIP LOCKED` (ADR-0006).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // Feed order: the earlier of the claimed createdAt and when we first saw the
  // record, so a backdated or future-dated createdAt cannot jump the queue.
  await db.schema
    .alterTable('video_post')
    .addColumn('sort_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('aspect_width', 'integer')
    .addColumn('aspect_height', 'integer')
    // The record as indexed, returned verbatim in hydrated post views.
    .addColumn('record', 'jsonb')
    .execute()

  await db.schema
    .createIndex('video_post_sort_at_uri_idx')
    .on('video_post')
    .columns(['sort_at desc', 'uri desc'])
    .execute()

  await db.schema
    .createIndex('video_post_author_did_video_cid_idx')
    .on('video_post')
    .columns(['author_did', 'video_cid'])
    .execute()

  await db.schema
    .createTable('video_media')
    .addColumn('author_did', 'text', (col) => col.notNull())
    .addColumn('video_cid', 'text', (col) => col.notNull())
    .addColumn('status', 'text', (col) =>
      col
        .notNull()
        .defaultTo('pending')
        .check(sql`status in ('pending', 'processing', 'ready', 'failed')`),
    )
    .addColumn('attempts', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('last_error', 'text')
    .addColumn('claimed_at', 'timestamptz')
    .addColumn('width', 'integer')
    .addColumn('height', 'integer')
    .addColumn('duration_ms', 'integer')
    .addColumn('ready_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addPrimaryKeyConstraint('video_media_pkey', ['author_did', 'video_cid'])
    .execute()

  await db.schema
    .createIndex('video_media_status_created_at_idx')
    .on('video_media')
    .columns(['status', 'created_at'])
    .execute()

  await db.schema
    .createTable('sync_cursor')
    .addColumn('name', 'text', (col) => col.primaryKey())
    // Jetstream time_us: microseconds since the epoch.
    .addColumn('cursor', 'bigint', (col) => col.notNull())
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('sync_cursor').execute()
  await db.schema.dropTable('video_media').execute()
  await db.schema.dropIndex('video_post_author_did_video_cid_idx').execute()
  await db.schema.dropIndex('video_post_sort_at_uri_idx').execute()
  await db.schema
    .alterTable('video_post')
    .dropColumn('record')
    .dropColumn('aspect_height')
    .dropColumn('aspect_width')
    .dropColumn('sort_at')
    .execute()
}
