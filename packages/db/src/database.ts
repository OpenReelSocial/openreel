import { Kysely, PostgresDialect, type ColumnType, type Generated } from 'kysely'
import pg from 'pg'

/**
 * A `timestamptz` column: read back as a `Date`, written as a `Date` or an
 * ISO-8601 string.
 */
export type Timestamp = ColumnType<Date, Date | string, Date | string>

/** A `timestamptz` column with a database default, so inserts may omit it. */
export type GeneratedTimestamp = ColumnType<Date, Date | string | undefined, Date | string>

/**
 * Table types for the shared OpenReel database.
 *
 * This is an index over AT Protocol records, not the system of record: the
 * canonical `social.openreel.*` records live in users' repositories on their
 * PDS, and every row here can be rebuilt from the firehose. Columns use
 * `snake_case`, times are `timestamptz`, and strings are `text`.
 *
 * The interface is hand-written and must be kept in step with the migrations
 * under `src/migrations/`. Generating it with kysely-codegen is a possible later
 * step (see ADR-0003).
 */
export interface Database {
  actor: ActorTable
  video_post: VideoPostTable
  watch_event: WatchEventTable
  video_post_stats: VideoPostStatsTable
}

/** An account seen on the network, keyed by DID. */
export interface ActorTable {
  did: string
  /** Current handle, if resolved. Handles change; DIDs do not. */
  handle: string | null
  indexed_at: GeneratedTimestamp
}

/** Index of a `social.openreel.video.post` record. */
export interface VideoPostTable {
  /** AT-URI of the record (`at://<did>/<collection>/<rkey>`). */
  uri: string
  /** CID of the record version that was indexed. */
  cid: string
  author_did: string
  caption: string | null
  duration_ms: number | null
  /** CID of the video blob on the author's PDS. */
  video_cid: string | null
  thumbnail_cid: string | null
  /** `createdAt` as claimed by the record. */
  created_at: Timestamp
  indexed_at: GeneratedTimestamp
}

/** Index of a `social.openreel.engagement.watchEvent` record. */
export interface WatchEventTable {
  uri: string
  cid: string
  /** DID of the viewer whose repository holds the record. */
  actor_did: string
  /** AT-URI of the video post that was watched. Not a foreign key: the post may not be indexed yet. */
  subject_uri: string
  subject_cid: string | null
  watch_duration_ms: number | null
  /** Fraction of the video watched, 0-1. */
  completion_rate: number | null
  sound_enabled: boolean | null
  rewatch_count: number | null
  created_at: Timestamp
  indexed_at: GeneratedTimestamp
}

/**
 * Aggregate engagement per video post, derived from `watch_event`. This is the
 * seam feed generators read from; nothing individual is stored here.
 */
export interface VideoPostStatsTable {
  uri: string
  view_count: Generated<number>
  avg_completion_rate: number | null
  updated_at: GeneratedTimestamp
}

/**
 * Postgres returns `bigint` (int8) as a string because it can exceed
 * `Number.MAX_SAFE_INTEGER`. Counters in this schema never will, so parse to a
 * number for this pool only rather than mutating the global `pg` type registry.
 */
const int8AsNumber: pg.CustomTypesConfig = {
  getTypeParser: (id, format): ((value: string) => unknown) => {
    if (id === pg.types.builtins.INT8 && format !== 'binary') return Number
    // pg-types declares its parsers as `any`; narrow at the boundary.
    const parser: unknown = pg.types.getTypeParser(id, format)
    if (typeof parser !== 'function') {
      throw new Error(`pg-types returned no parser for type oid ${id}`)
    }
    return parser as (value: string) => unknown
  },
}

/**
 * Opens a connection pool to `connectionString` and wraps it in a typed Kysely
 * instance. Nothing is connected until the first query. Close it with
 * {@link closeDb}.
 */
export function createDb(connectionString: string): Kysely<Database> {
  if (connectionString.trim() === '') {
    throw new Error('createDb: connection string is empty; set DATABASE_URL')
  }

  const pool = new pg.Pool({ connectionString, types: int8AsNumber })

  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
  })
}

/** Ends every pooled connection. The instance must not be used afterwards. */
export async function closeDb(db: Kysely<Database>): Promise<void> {
  await db.destroy()
}
