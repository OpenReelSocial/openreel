import type { Database, TappedQuery } from '@openreel/db'
import type { Response } from 'express'
import { sql, type Kysely } from 'kysely'

/**
 * Fans tapped queries out to every open debug page, keeping the most recent
 * ones so a page opened mid-demo starts with context rather than a blank list.
 */
export class QueryFeed {
  static readonly BACKLOG = 200

  readonly #backlog: TappedQuery[] = []
  readonly #subscribers = new Set<(query: TappedQuery) => void>()

  push(query: TappedQuery): void {
    this.#backlog.push(query)
    if (this.#backlog.length > QueryFeed.BACKLOG) this.#backlog.shift()
    for (const subscriber of this.#subscribers) subscriber(query)
  }

  /** Streams the backlog, then every new query, as server-sent events. */
  stream(res: Response): void {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    const send = (query: TappedQuery) => res.write(`data: ${JSON.stringify(query)}\n\n`)
    for (const query of this.#backlog) send(query)
    this.#subscribers.add(send)
    // Comments keep proxies from closing an idle stream.
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 15_000)
    res.on('close', () => {
      clearInterval(heartbeat)
      this.#subscribers.delete(send)
    })
  }
}

/** Everything the debug page's pipeline panels show, read in one go. */
export async function pipelineSnapshot(db: Kysely<Database>) {
  const [counts, media, cursors, mostViewed, recentWatches, recentJobs] = await Promise.all([
    sql<{ actors: number; posts: number; watchEvents: number; viewers: number }>`
      select
        (select count(*) from actor)::int as actors,
        (select count(*) from video_post)::int as "posts",
        (select count(*) from watch_event)::int as "watchEvents",
        (select count(distinct actor_did) from watch_event)::int as viewers
    `.execute(db),
    db
      .selectFrom('video_media')
      .select(['status', (eb) => eb.fn.countAll<number>().as('count')])
      .groupBy('status')
      .execute(),
    db.selectFrom('sync_cursor').select(['name', 'cursor', 'updated_at']).execute(),
    db
      .selectFrom('video_post_stats as s')
      .innerJoin('video_post as p', 'p.uri', 's.uri')
      .leftJoin('actor as a', 'a.did', 'p.author_did')
      .select([
        'p.uri',
        'p.caption',
        'a.handle',
        's.view_count',
        's.avg_completion_rate',
        's.updated_at',
      ])
      .where('s.view_count', '>', 0)
      .orderBy('s.view_count', 'desc')
      .orderBy('p.sort_at', 'desc')
      .limit(8)
      .execute(),
    db
      .selectFrom('watch_event as w')
      .leftJoin('actor as a', 'a.did', 'w.actor_did')
      .leftJoin('video_post as p', 'p.uri', 'w.subject_uri')
      .select([
        'w.uri',
        'a.handle as viewer',
        'w.actor_did',
        'p.caption',
        'w.watch_duration_ms',
        'w.completion_rate',
        'w.rewatch_count',
        'w.created_at',
        'w.indexed_at',
      ])
      .orderBy('w.indexed_at', 'desc')
      .limit(8)
      .execute(),
    db
      .selectFrom('video_media')
      .select(['author_did', 'video_cid', 'status', 'attempts', 'last_error', 'updated_at'])
      .orderBy('updated_at', 'desc')
      .limit(6)
      .execute(),
  ])

  return {
    at: new Date().toISOString(),
    counts: counts.rows[0],
    media: Object.fromEntries(media.map((row) => [row.status, Number(row.count)])),
    // Jetstream cursors are microseconds since the epoch.
    cursors: cursors.map((row) => ({
      name: row.name,
      eventAt: new Date(Math.floor(row.cursor / 1000)).toISOString(),
      savedAt: row.updated_at,
    })),
    mostViewed,
    recentWatches,
    recentJobs,
  }
}
