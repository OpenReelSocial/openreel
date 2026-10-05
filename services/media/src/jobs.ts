import type { Database } from '@openreel/db'
import { sql, type Kysely } from 'kysely'

export interface Job {
  authorDid: string
  videoCid: string
  attempts: number
}

/** How long a claimed job may run before another worker assumes it died. */
const STALE_CLAIM = sql`interval '15 minutes'`

/**
 * Claims the oldest runnable job: pending, failed but due a retry (backing off
 * a minute per attempt), or claimed by a worker that went quiet. `SKIP LOCKED`
 * lets several workers poll the same table without blocking each other. Blobs
 * no post references any more (deleted before transcoding) are skipped.
 */
export async function claimJob(
  db: Kysely<Database>,
  maxAttempts: number,
): Promise<Job | undefined> {
  const result = await sql<{ author_did: string; video_cid: string; attempts: number }>`
    update video_media
    set status = 'processing', claimed_at = now(), attempts = attempts + 1, updated_at = now()
    where (author_did, video_cid) = (
      select m.author_did, m.video_cid from video_media m
      where (
          m.status = 'pending'
          or (m.status = 'failed' and m.attempts < ${maxAttempts}
              and m.updated_at < now() - m.attempts * interval '1 minute')
          or (m.status = 'processing' and m.attempts < ${maxAttempts}
              and m.claimed_at < now() - ${STALE_CLAIM})
        )
        and exists (
          select 1 from video_post p
          where p.author_did = m.author_did and p.video_cid = m.video_cid
        )
      order by m.created_at
      limit 1
      for update skip locked
    )
    returning author_did, video_cid, attempts
  `.execute(db)

  const row = result.rows[0]
  return row && { authorDid: row.author_did, videoCid: row.video_cid, attempts: row.attempts }
}

export async function completeJob(
  db: Kysely<Database>,
  job: Job,
  media: { width: number; height: number; durationMs: number },
): Promise<void> {
  await db
    .updateTable('video_media')
    .set({
      status: 'ready',
      width: media.width,
      height: media.height,
      duration_ms: media.durationMs,
      last_error: null,
      ready_at: new Date(),
      updated_at: new Date(),
    })
    .where('author_did', '=', job.authorDid)
    .where('video_cid', '=', job.videoCid)
    .execute()
}

export async function failJob(db: Kysely<Database>, job: Job, error: string): Promise<void> {
  await db
    .updateTable('video_media')
    .set({ status: 'failed', last_error: error.slice(0, 2_000), updated_at: new Date() })
    .where('author_did', '=', job.authorDid)
    .where('video_cid', '=', job.videoCid)
    .execute()
}

/** Job counts by status, for the status endpoint. */
export async function queueStats(db: Kysely<Database>): Promise<Record<string, number>> {
  const rows = await db
    .selectFrom('video_media')
    .select(['status', db.fn.countAll<number>().as('count')])
    .groupBy('status')
    .execute()
  const stats: Record<string, number> = { pending: 0, processing: 0, ready: 0, failed: 0 }
  for (const row of rows) stats[row.status] = Number(row.count)
  return stats
}
