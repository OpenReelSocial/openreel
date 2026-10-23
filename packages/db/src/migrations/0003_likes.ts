import { sql, type Kysely } from 'kysely'

/**
 * Likes: one row per indexed `social.openreel.engagement.like` record, and a
 * per-post like count beside the view count feeds already rank by.
 *
 * Like `watch_event`, the subject is not a foreign key: a like can arrive
 * before, or outlive, the post it points at. Nothing stops an account writing
 * two likes of one post, so `like_count` counts distinct likers, not rows.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('video_like')
    .addColumn('uri', 'text', (col) => col.primaryKey())
    .addColumn('cid', 'text', (col) => col.notNull())
    .addColumn('actor_did', 'text', (col) => col.notNull().references('actor.did'))
    .addColumn('subject_uri', 'text', (col) => col.notNull())
    .addColumn('subject_cid', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull())
    .addColumn('indexed_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()

  await db.schema
    .createIndex('video_like_subject_uri_idx')
    .on('video_like')
    .column('subject_uri')
    .execute()

  await db.schema
    .createIndex('video_like_actor_did_idx')
    .on('video_like')
    .column('actor_did')
    .execute()

  await db.schema
    .alterTable('video_post_stats')
    .addColumn('like_count', 'bigint', (col) => col.notNull().defaultTo(0))
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('video_post_stats').dropColumn('like_count').execute()
  await db.schema.dropTable('video_like').execute()
}
