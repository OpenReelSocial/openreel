import { sql, type Kysely } from 'kysely'

/**
 * Takedowns (#120) and rendition removal.
 *
 * `moderation_takedown` lists the accounts (DIDs) and records (AT-URIs) an
 * operator took down through the AppView's `com.atproto.admin.updateSubjectStatus`.
 * The indexer deletes what it had for them and refuses to index them again,
 * so a firehose replay cannot bring them back.
 *
 * `video_media` gains a `removing` status: renditions of a blob no indexed
 * post uses any more, queued for the media service to delete from storage
 * and the CDN. The row goes once they are gone.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('moderation_takedown')
    .addColumn('subject', 'text', (col) => col.primaryKey())
    // The moderation action's reference, as passed to updateSubjectStatus.
    .addColumn('ref', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()

  await sql`alter table video_media drop constraint video_media_status_check`.execute(db)
  await sql`
    alter table video_media add constraint video_media_status_check
    check (status in ('pending', 'processing', 'ready', 'failed', 'removing'))
  `.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`delete from video_media where status = 'removing'`.execute(db)
  await sql`alter table video_media drop constraint video_media_status_check`.execute(db)
  await sql`
    alter table video_media add constraint video_media_status_check
    check (status in ('pending', 'processing', 'ready', 'failed'))
  `.execute(db)
  await db.schema.dropTable('moderation_takedown').execute()
}
