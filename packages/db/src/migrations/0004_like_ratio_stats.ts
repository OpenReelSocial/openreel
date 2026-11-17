import { sql, type Kysely } from 'kysely'

/**
 * Per-post counts for a like ratio measured within one population.
 *
 * Views come only from viewers who opted in to sharing watch history, while
 * likes need no opt-in, so `like_count / view_count` mixes two audiences and
 * favors posts whose viewers do not share. These columns count only accounts
 * that shared a watch of the post:
 *
 * - `viewer_count`: distinct accounts with a watch event for the post, so a
 *   rewatch does not count twice;
 * - `viewer_like_count`: how many of those accounts also like it.
 *
 * Existing rows are backfilled from the indexed events.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('video_post_stats')
    .addColumn('viewer_count', 'bigint', (col) => col.notNull().defaultTo(0))
    .addColumn('viewer_like_count', 'bigint', (col) => col.notNull().defaultTo(0))
    .execute()

  await sql`
    update video_post_stats s set
      viewer_count = (
        select count(distinct w.actor_did) from watch_event w where w.subject_uri = s.uri
      ),
      viewer_like_count = (
        select count(distinct l.actor_did) from video_like l
        where l.subject_uri = s.uri
          and exists (
            select 1 from watch_event w
            where w.subject_uri = s.uri and w.actor_did = l.actor_did
          )
      )
  `.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('video_post_stats')
    .dropColumn('viewer_like_count')
    .dropColumn('viewer_count')
    .execute()
}
