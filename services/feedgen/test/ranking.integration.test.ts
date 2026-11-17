import { sql, type Kysely } from 'kysely'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { closeDb, createDb, migrateToLatest, type Database } from '@openreel/db'

import type { SignalWeight } from '../src/config.ts'
import { loadFeeds } from '../src/config.ts'
import { weighted } from '../src/feeds.ts'

/**
 * Runs the weighted scoring SQL against a real Postgres when TEST_DATABASE_URL
 * is set (see packages/db/test/integration.test.ts). The suite works in its own
 * database beside that one, recreated per run, so it cannot race other
 * packages' database suites when turbo runs them in parallel.
 */
const testDatabaseUrl = process.env['TEST_DATABASE_URL'] ?? ''
const hasDb = testDatabaseUrl !== ''

const AUTHOR = 'did:plc:rankingtest00000000000001'
const HOUR = 3_600_000

interface Fixture {
  ageHours?: number
  /** Omit for a post with no stats row at all. */
  stats?: {
    views?: number
    completion?: number | null
    likes?: number
    viewers?: number
    viewerLikes?: number
  }
}

describe.skipIf(!hasDb)('weighted ranking against Postgres', () => {
  let db: Kysely<Database>
  let drop: () => Promise<void>

  beforeAll(async () => {
    ;({ db, drop } = await freshDatabase('openreel_feedgen_ranking_test'))
  })

  afterAll(() => drop())

  beforeEach(async () => {
    await sql`truncate actor, video_post, video_media, video_post_stats cascade`.execute(db)
    await db.insertInto('actor').values({ did: AUTHOR, handle: 'ranking.test' }).execute()
  })

  async function post(name: string, fixture: Fixture = {}): Promise<string> {
    const uri = `at://${AUTHOR}/social.openreel.video.post/${name}`
    const sortAt = new Date(Date.now() - (fixture.ageHours ?? 0) * HOUR)
    await db
      .insertInto('video_post')
      .values({
        uri,
        cid: `cid-${name}`,
        author_did: AUTHOR,
        video_cid: `video-${name}`,
        created_at: sortAt,
        sort_at: sortAt,
      })
      .execute()
    await db
      .insertInto('video_media')
      .values({ author_did: AUTHOR, video_cid: `video-${name}`, status: 'ready' })
      .execute()
    const stats = fixture.stats
    if (stats !== undefined) {
      await db
        .insertInto('video_post_stats')
        .values({
          uri,
          view_count: stats.views ?? 0,
          avg_completion_rate: stats.completion ?? null,
          like_count: stats.likes ?? 0,
          viewer_count: stats.viewers ?? 0,
          viewer_like_count: stats.viewerLikes ?? 0,
        })
        .execute()
    }
    return uri
  }

  async function rank(weights: SignalWeight[]): Promise<string[]> {
    const page = await weighted(weights).page(db, 100, undefined)
    return page.feed.map((item) => item.post.split('/').pop() ?? '')
  }

  it('scores a post with no stats or no views at the site mean completion', async () => {
    // Site mean is (40 * 0.9 + 40 * 0.3) / 80 = 0.6.
    await post('high', { ageHours: 3, stats: { views: 40, completion: 0.9 } })
    await post('none', { ageHours: 2 })
    await post('zero', { ageHours: 1, stats: { views: 0, completion: null } })
    await post('low', { ageHours: 0, stats: { views: 40, completion: 0.3 } })

    expect(await rank([{ signal: 'completion', weight: 1 }])).toEqual([
      'high',
      'zero',
      'none',
      'low',
    ])
  })

  it('falls back to newest first when nothing has views', async () => {
    await post('older', { ageHours: 2 })
    await post('newer', { ageHours: 1, stats: { likes: 5 } })

    expect(
      await rank([
        { signal: 'completion', weight: 0.5 },
        { signal: 'likeRatio', weight: 0.5 },
      ]),
    ).toEqual(['newer', 'older'])
  })

  it('does not let one view at 100% completion beat many views at 90%', async () => {
    await post('one', { stats: { views: 1, completion: 1 } })
    await post('many', { ageHours: 1, stats: { views: 40, completion: 0.9 } })
    await post('weak', { ageHours: 2, stats: { views: 40, completion: 0.2 } })

    expect(await rank([{ signal: 'completion', weight: 1 }])).toEqual(['many', 'one', 'weak'])
  })

  it('does not let one viewer who liked beat many viewers who mostly liked', async () => {
    await post('one', { stats: { views: 1, viewers: 1, likes: 1, viewerLikes: 1 } })
    await post('many', {
      ageHours: 1,
      stats: { views: 40, viewers: 40, likes: 30, viewerLikes: 30 },
    })
    await post('weak', { ageHours: 2, stats: { views: 40, viewers: 40, likes: 4, viewerLikes: 4 } })

    expect(await rank([{ signal: 'likeRatio', weight: 1 }])).toEqual(['many', 'one', 'weak'])
  })

  it('ignores likes from accounts that did not share a watch', async () => {
    // Fifty likes, but only one from the ten accounts that shared a watch.
    await post('liked', { stats: { views: 10, viewers: 10, likes: 50, viewerLikes: 1 } })
    await post('ratio', {
      ageHours: 1,
      stats: { views: 10, viewers: 10, likes: 5, viewerLikes: 5 },
    })

    expect(await rank([{ signal: 'likeRatio', weight: 1 }])).toEqual(['ratio', 'liked'])
  })

  it('ranks the shipped Trending feed by completion, like ratio, and recency', async () => {
    const trending = loadFeeds().find((feed) => feed.id === 'trending')
    if (trending?.ranking.type !== 'weighted') throw new Error('Trending must be a weighted feed')

    // Scores: loved 0.73 (a day old), fresh 0.64 (site means, new), skipped 0.40 (new).
    await post('loved', {
      ageHours: 24,
      stats: { views: 40, completion: 0.95, viewers: 40, likes: 35, viewerLikes: 35 },
    })
    await post('fresh')
    await post('skipped', { stats: { views: 40, completion: 0.1, viewers: 40 } })

    expect(await rank(trending.ranking.weights)).toEqual(['loved', 'fresh', 'skipped'])
  })
})

/** Same as services/appview/test/db.ts: a database of its own, migrated to the latest. */
async function freshDatabase(
  name: string,
): Promise<{ db: Kysely<Database>; drop: () => Promise<void> }> {
  const admin = createDb(testDatabaseUrl)
  await sql`drop database if exists ${sql.id(name)}`.execute(admin)
  await sql`create database ${sql.id(name)}`.execute(admin)
  const url = new URL(testDatabaseUrl)
  url.pathname = `/${name}`
  const db = createDb(url.toString())
  await migrateToLatest(db)
  return {
    db,
    drop: async () => {
      await closeDb(db)
      await sql`drop database if exists ${sql.id(name)}`.execute(admin)
      await closeDb(admin)
    },
  }
}
