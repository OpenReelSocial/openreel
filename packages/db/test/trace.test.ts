import { EventEmitter } from 'node:events'

import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  sql,
} from 'kysely'
import { afterEach, describe, expect, it } from 'vitest'

import type { Database } from '../src/database.ts'
import {
  describeQuery,
  encodeEvent,
  isRootEvent,
  purpose,
  queryTapOptions,
  setTraceSink,
  sqlTap,
  traceHeaders,
  traceRequests,
  traceRoot,
  traceStep,
  TRACE_HEADER,
  type SqlEvent,
  type TraceEvent,
} from '../src/trace.ts'

/** Compiles and "runs" queries without a database; every query returns no rows. */
function offlineDb(plugins: ReturnType<typeof sqlTap> | undefined = undefined): Kysely<Database> {
  return new Kysely<Database>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
    ...(plugins === undefined ? {} : { log: plugins.log, plugins: [plugins.plugin] }),
  })
}

function capture(): TraceEvent[] {
  const events: TraceEvent[] = []
  setTraceSink('appview', (event) => events.push(event))
  return events
}

afterEach(() => setTraceSink(undefined))

describe('describeQuery', () => {
  const db = offlineDb()

  it('reads the tables a select joins', () => {
    const query = db
      .selectFrom('video_post as p')
      .innerJoin('actor as a', 'a.did', 'p.author_did')
      .select('p.uri')
      .compile()
    expect(describeQuery(query)).toEqual({ op: 'select', reads: ['video_post', 'actor'] })
  })

  it('separates the table a write changes from the ones it reads', () => {
    const query = db
      .insertInto('video_post_stats')
      .columns(['uri'])
      .expression(db.selectFrom('video_post as p').select('p.uri'))
      .onConflict((oc) => oc.column('uri').doNothing())
      .compile()
    expect(describeQuery(query)).toEqual({
      op: 'upsert',
      writes: 'video_post_stats',
      reads: ['video_post'],
    })
    expect(describeQuery(db.deleteFrom('video_like').where('uri', '=', 'x').compile())).toEqual({
      op: 'delete',
      writes: 'video_like',
      reads: [],
    })
    expect(describeQuery(db.updateTable('video_media').set({ status: 'ready' }).compile())).toEqual(
      { op: 'update', writes: 'video_media', reads: [] },
    )
  })

  it('reads raw SQL from its text and skips transaction control', () => {
    const raw = sql`update video_media set status = 'processing' where (a, b) = (
      select m.a, m.b from video_media m where exists (select 1 from video_post p)
    ) returning a`.compile(db)
    expect(describeQuery(raw)).toEqual({
      op: 'update',
      writes: 'video_media',
      reads: ['video_post'],
    })
    expect(describeQuery(sql`begin`.compile(db))).toBeUndefined()
  })
})

describe('tracing', () => {
  it('is off unless DEBUG_QUERY_TAP=1', () => {
    expect(queryTapOptions('appview', {})).toEqual({})
    expect(queryTapOptions('appview', { DEBUG_QUERY_TAP: '0' })).toEqual({})
    expect(queryTapOptions('appview', { DEBUG_QUERY_TAP: '1' })).toEqual({ queryTap: 'appview' })
  })

  it('groups a root, its labelled queries, and its steps under one trace', async () => {
    const events = capture()
    const db = offlineDb(sqlTap())

    await traceRoot(
      { kind: 'firehose', event: 'commit', did: 'did:plc:x', relayMs: 12 },
      async () => {
        await purpose('Record the like', () =>
          db
            .insertInto('video_like')
            .values({} as never)
            .execute(),
        )
        await traceStep(
          'Look up this person’s handle',
          { kind: 'call', target: 'plc', method: 'GET', path: '/did:plc:x' },
          (note) => Promise.resolve(note({ status: 200 })),
        )
      },
    )

    const [query, call, root] = events as [SqlEvent, TraceEvent, TraceEvent]
    expect(query).toMatchObject({
      kind: 'sql',
      service: 'appview',
      op: 'insert',
      writes: 'video_like',
      purpose: 'Record the like',
      rows: 0,
    })
    expect(call).toMatchObject({ kind: 'call', target: 'plc', status: 200 })
    expect(root).toMatchObject({ kind: 'firehose', relayMs: 12 })
    expect(isRootEvent(root)).toBe(true)
    expect(query.trace).toBeDefined()
    expect(call.trace).toBe(query.trace)
    expect(root.trace).toBe(query.trace)
  })

  it('leaves background queries out of any trace', async () => {
    const events = capture()
    await purpose('Check for videos waiting to be transcoded', () =>
      offlineDb(sqlTap()).selectFrom('video_media').selectAll().execute(),
    )
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ purpose: 'Check for videos waiting to be transcoded' })
    expect(events[0]?.trace).toBeUndefined()
  })

  it('records a failed step and rethrows', async () => {
    const events = capture()
    await expect(
      traceStep('Download the original video', { kind: 'work', what: 'x' }, () =>
        Promise.reject(new Error('boom')),
      ),
    ).rejects.toThrow('boom')
    expect(events[0]).toMatchObject({ kind: 'work', error: 'boom' })
  })

  it('does nothing without a sink', async () => {
    expect(
      await traceRoot({ kind: 'job', name: 'x', did: 'd', subject: 's' }, () => Promise.resolve(7)),
    ).toBe(7)
    expect(traceHeaders()).toEqual({})
  })

  it('keeps payloads under the NOTIFY limit', () => {
    const event: SqlEvent = {
      kind: 'sql',
      service: 'appview',
      op: 'insert',
      reads: [],
      sql: '"x"'.repeat(2000),
      params: Array.from({ length: 16 }, () => '"'.repeat(100)),
      at: new Date(0).toISOString(),
      ms: 1,
    }
    expect(Buffer.byteLength(encodeEvent(event))).toBeLessThan(8000)
  })
})

describe('traceRequests', () => {
  function serve(headers: Record<string, string>): Promise<{ inside: unknown }> {
    const res = Object.assign(new EventEmitter(), { statusCode: 200 })
    return new Promise((resolve) => {
      traceRequests()({ method: 'GET', originalUrl: '/xrpc/x', headers }, res, () => {
        const inside = traceHeaders()
        res.emit('finish')
        resolve({ inside })
      })
    })
  }

  it('starts a trace for an outside request and passes it on to calls', async () => {
    const events = capture()
    const { inside } = await serve({ 'user-agent': 'OpenReel/1 CFNetwork/1' })
    expect(events[0]).toMatchObject({ kind: 'request', status: 200, client: 'OpenReel/1' })
    expect(isRootEvent(events[0] as TraceEvent)).toBe(true)
    expect(inside).toEqual({
      [TRACE_HEADER]: events[0]?.trace,
      'x-openreel-caller': 'appview',
    })
  })

  it("joins the caller's trace when another service sent one", async () => {
    const events = capture()
    await serve({ [TRACE_HEADER]: 'abc-123', 'x-openreel-caller': 'appview' })
    expect(events[0]).toMatchObject({ trace: 'abc-123', from: 'appview' })
    expect(isRootEvent(events[0] as TraceEvent)).toBe(false)
  })
})
