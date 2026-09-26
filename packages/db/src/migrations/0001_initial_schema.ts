import { sql, type Kysely } from 'kysely'

/**
 * Initial schema: an index of actors, video posts, and watch events as the
 * AppView will ingest them from the firehose, plus a per-post aggregate table
 * as the seam feed generators read from.
 *
 * Migrations are typed `Kysely<unknown>` on purpose. They describe the schema at
 * one point in history, so they must not depend on the current `Database`
 * interface, which will keep changing.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('actor')
    .addColumn('did', 'text', (col) => col.primaryKey())
    .addColumn('handle', 'text', (col) => col.unique())
    .addColumn('indexed_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()

  await db.schema
    .createTable('video_post')
    .addColumn('uri', 'text', (col) => col.primaryKey())
    .addColumn('cid', 'text', (col) => col.notNull())
    .addColumn('author_did', 'text', (col) => col.notNull().references('actor.did'))
    .addColumn('caption', 'text')
    .addColumn('duration_ms', 'integer')
    .addColumn('video_cid', 'text')
    .addColumn('thumbnail_cid', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull())
    .addColumn('indexed_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()

  await db.schema
    .createIndex('video_post_author_did_created_at_idx')
    .on('video_post')
    .columns(['author_did', 'created_at desc'])
    .execute()

  await db.schema
    .createIndex('video_post_created_at_idx')
    .on('video_post')
    .columns(['created_at desc'])
    .execute()

  await db.schema
    .createTable('watch_event')
    .addColumn('uri', 'text', (col) => col.primaryKey())
    .addColumn('cid', 'text', (col) => col.notNull())
    .addColumn('actor_did', 'text', (col) => col.notNull().references('actor.did'))
    // Not a foreign key: a watch event can arrive before, or outlive, its post.
    .addColumn('subject_uri', 'text', (col) => col.notNull())
    .addColumn('subject_cid', 'text')
    .addColumn('watch_duration_ms', 'integer')
    .addColumn('completion_rate', 'real')
    .addColumn('sound_enabled', 'boolean')
    .addColumn('rewatch_count', 'integer')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull())
    .addColumn('indexed_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()

  await db.schema
    .createIndex('watch_event_subject_uri_idx')
    .on('watch_event')
    .column('subject_uri')
    .execute()

  await db.schema
    .createTable('video_post_stats')
    .addColumn('uri', 'text', (col) =>
      col.primaryKey().references('video_post.uri').onDelete('cascade'),
    )
    .addColumn('view_count', 'bigint', (col) => col.notNull().defaultTo(0))
    .addColumn('avg_completion_rate', 'double precision')
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Reverse dependency order; indexes go with their tables.
  await db.schema.dropTable('video_post_stats').execute()
  await db.schema.dropTable('watch_event').execute()
  await db.schema.dropTable('video_post').execute()
  await db.schema.dropTable('actor').execute()
}
