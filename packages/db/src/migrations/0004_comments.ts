import { sql, type Kysely } from 'kysely'

/**
 * Comments: one row per indexed `social.openreel.video.comment` record, and a
 * per-post comment count beside the like count.
 *
 * Unlike likes, a comment is only indexed once its video (and, for a reply,
 * its top-level comment) is, so both are foreign keys. Deleting a post drops
 * its comments, and deleting a top-level comment drops its replies, the way
 * the thread disappears from a client. Threads are one level deep: a reply's
 * parent is always a top-level comment on the same video.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('video_comment')
    .addColumn('uri', 'text', (col) => col.primaryKey())
    .addColumn('cid', 'text', (col) => col.notNull())
    .addColumn('author_did', 'text', (col) => col.notNull().references('actor.did'))
    .addColumn('subject_uri', 'text', (col) =>
      col.notNull().references('video_post.uri').onDelete('cascade'),
    )
    .addColumn('subject_cid', 'text')
    // Null for a top-level comment.
    .addColumn('parent_uri', 'text', (col) =>
      col.references('video_comment.uri').onDelete('cascade'),
    )
    .addColumn('text', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull())
    .addColumn('indexed_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    // Display order: the earlier of the claimed createdAt and first-indexed time.
    .addColumn('sort_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    // The record as indexed, returned verbatim in comment views.
    .addColumn('record', 'jsonb', (col) => col.notNull())
    .execute()

  // A video's comments, newest first; also serves comment counts and the
  // cascade from video_post.
  await db.schema
    .createIndex('video_comment_subject_uri_idx')
    .on('video_comment')
    .columns(['subject_uri', 'sort_at desc', 'uri desc'])
    .execute()

  // Replies to a comment, oldest first; also serves reply counts.
  await db.schema
    .createIndex('video_comment_parent_idx')
    .on('video_comment')
    .columns(['parent_uri', 'sort_at', 'uri'])
    .execute()

  await db.schema
    .createIndex('video_comment_author_did_idx')
    .on('video_comment')
    .column('author_did')
    .execute()

  await db.schema
    .alterTable('video_post_stats')
    .addColumn('comment_count', 'bigint', (col) => col.notNull().defaultTo(0))
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('video_post_stats').dropColumn('comment_count').execute()
  await db.schema.dropTable('video_comment').execute()
}
