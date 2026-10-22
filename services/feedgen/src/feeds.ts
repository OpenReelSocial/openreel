import type { Database } from '@openreel/db'
import { sql, type Kysely } from 'kysely'

import type { FeedDefinition, SignalWeight } from './config.ts'

export interface SkeletonPage {
  feed: { post: string }[]
  cursor?: string
}

/** A feed this generator serves, keyed by its generator record's rkey. */
export interface Feed {
  /** Returns one page; `cursor` is whatever the previous page returned. */
  page(db: Kysely<Database>, limit: number, cursor: string | undefined): Promise<SkeletonPage>
}

/** Thrown for a cursor this generator did not issue. */
export class InvalidCursorError extends Error {}

/**
 * Cursor for (sort_at, uri) keyset paging: `<epoch ms>::<uri>`. The URI breaks
 * ties between posts with the same timestamp. sort_at is written from a JS Date
 * in the indexer, so millisecond precision loses nothing.
 */
export function encodeCursor(sortAt: Date, uri: string): string {
  return `${sortAt.getTime()}::${uri}`
}

export function decodeCursor(cursor: string): { sortAt: Date; uri: string } {
  const sep = cursor.indexOf('::')
  const ms = Number(cursor.slice(0, sep))
  const uri = cursor.slice(sep + 2)
  if (sep < 1 || !Number.isSafeInteger(ms) || !uri.startsWith('at://')) {
    throw new InvalidCursorError('malformed cursor')
  }
  return { sortAt: new Date(ms), uri }
}

/** Newest first, no ranking: every indexed video whose media is ready to play. */
export const chronological: Feed = {
  async page(db, limit, cursor) {
    let query = db
      .selectFrom('video_post as p')
      .innerJoin('video_media as m', (join) =>
        join.onRef('m.author_did', '=', 'p.author_did').onRef('m.video_cid', '=', 'p.video_cid'),
      )
      .select(['p.uri', 'p.sort_at'])
      .where('m.status', '=', 'ready')
      .orderBy('p.sort_at', 'desc')
      .orderBy('p.uri', 'desc')
      .limit(limit)

    if (cursor !== undefined) {
      const after = decodeCursor(cursor)
      query = query.where((eb) =>
        eb.or([
          eb('p.sort_at', '<', after.sortAt),
          eb.and([eb('p.sort_at', '=', after.sortAt), eb('p.uri', '<', after.uri)]),
        ]),
      )
    }

    const rows = await query.execute()
    const last = rows.at(-1)
    return {
      feed: rows.map((row) => ({ post: row.uri })),
      // A short page is the end of the feed.
      ...(last !== undefined && rows.length === limit
        ? { cursor: encodeCursor(last.sort_at, last.uri) }
        : {}),
    }
  },
}

/** Deepest offset a weighted feed pages to; past this a cursor is rejected. */
const MAX_OFFSET = 10_000

function decodeOffset(cursor: string): number {
  const offset = /^\d{1,5}$/.test(cursor) ? Number(cursor) : NaN
  if (!(offset >= 0 && offset <= MAX_OFFSET)) throw new InvalidCursorError('malformed cursor')
  return offset
}

/**
 * Scores every playable post as a weighted sum of signals, each normalized to
 * 0-1 (project plan 5.5.4):
 *
 * - `views`: the post's view count over the highest view count of any
 *   playable post, so the most-viewed post scores 1;
 * - `recency`: 1 when posted, halving every `halfLifeHours`.
 *
 * Ties fall back to newest first. Scores move as views arrive, so the cursor
 * is an offset rather than a keyset: a page can repeat or skip a post whose
 * rank changed since the previous page. Clients already drop repeats.
 */
export function weighted(weights: SignalWeight[]): Feed {
  const term = (w: SignalWeight) => {
    switch (w.signal) {
      case 'views':
        return sql<number>`${w.weight} * c.views`
      case 'recency':
        return sql<number>`${w.weight} * exp(-ln(2) * extract(epoch from (now() - c.sort_at)) / 3600 / ${w.halfLifeHours ?? 24})`
    }
  }
  const score = sql.join(weights.map(term), sql` + `)

  return {
    async page(db, limit, cursor) {
      const offset = cursor === undefined ? 0 : decodeOffset(cursor)
      const candidates = db
        .selectFrom('video_post as p')
        .innerJoin('video_media as m', (join) =>
          join.onRef('m.author_did', '=', 'p.author_did').onRef('m.video_cid', '=', 'p.video_cid'),
        )
        .leftJoin('video_post_stats as s', 's.uri', 'p.uri')
        .select([
          'p.uri',
          'p.sort_at',
          sql<number>`coalesce(s.view_count, 0)::float8 / greatest(max(coalesce(s.view_count, 0)) over (), 1)`.as(
            'views',
          ),
        ])
        .where('m.status', '=', 'ready')

      const rows = await db
        .selectFrom(candidates.as('c'))
        .select(['c.uri', sql<number>`${score}`.as('score')])
        .orderBy('score', 'desc')
        .orderBy('c.sort_at', 'desc')
        .orderBy('c.uri', 'desc')
        .limit(limit)
        .offset(offset)
        .execute()

      const next = offset + rows.length
      return {
        feed: rows.map((row) => ({ post: row.uri })),
        ...(rows.length === limit && next <= MAX_OFFSET ? { cursor: String(next) } : {}),
      }
    },
  }
}

/** Builds each configured feed, keyed by ID (the generator record's rkey). */
export function buildFeeds(definitions: FeedDefinition[]): Record<string, Feed> {
  return Object.fromEntries(
    definitions.map((def) => [
      def.id,
      def.ranking.type === 'chronological' ? chronological : weighted(def.ranking.weights),
    ]),
  )
}
