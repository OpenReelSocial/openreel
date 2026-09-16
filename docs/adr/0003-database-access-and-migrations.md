# ADR-0003: Database access layer and migrations

- **Status:** Accepted
- **Date:** 2026-09-15
- **Deciders:** ZackMurry

## Context

ADR-0002 chose Postgres 16 for local development and deliberately left two
things open under "Unresolved": the database access layer (query builder, ORM,
or plain driver) and the migration tool, to be decided "with the first real
schema". DEV-028 is that point: it requires a migration tool consistent with the
stack, an initial committed migration, and `make db-migrate` / `make db-reset`.

Constraints that shaped the choice:

1. **The stack is TypeScript on Node 22 (ADR-0002).** The access layer and
   migration tool should be TypeScript-native so schema changes are ordinary
   reviewed code, typechecked and linted by `make check`, with no second DSL or
   binary toolchain to install.
2. **The AT Protocol reference implementations set the precedent.** The upstream
   `@atproto` PDS, `bsky` AppView, and `ozone` moderation service all use Kysely
   over `pg`, with Kysely's own migrator. OpenReel's AppView and feed generator
   are the closest analogues to those services; matching their data-layer
   idioms keeps upstream code readable as a reference and lowers the barrier for
   contributors coming from that ecosystem.
3. **The database is an index, not the system of record.** Canonical
   `social.openreel.*` records live in user repositories on PDSs and arrive via
   the firehose. The schema will be reshaped repeatedly as the Lexicons settle
   (they are being authored concurrently), so the tooling must make additive
   migrations cheap and must not hide SQL behind an ORM's object model.
4. **`compose.yaml` already provisions one database**, `openreel`, and passes the
   same `DATABASE_URL` to both `appview` and `feedgen`. A per-service split would
   need a decision about who owns what before any service reads or writes a row.

## Decision

### Access layer

**Kysely** (type-safe SQL query builder) over the **`pg`** driver.

- Table types are a hand-written `Database` interface in
  `packages/db/src/database.ts`, kept beside the migrations that define them.
  Generating it with `kysely-codegen` is an option once the schema is larger;
  for now hand-writing keeps the package dependency-light and the types
  reviewable in the same diff as the migration.
- `pg-native` is not used; the pure-JS driver is sufficient and avoids a native
  build step.
- `bigint` columns are parsed to JavaScript numbers for OpenReel's pool only
  (counters here will not approach 2^53), rather than mutating `pg`'s global type
  registry.

### Migrations

**Kysely's built-in `Migrator`**, with migrations written in TypeScript under
`packages/db/src/migrations/` and registered explicitly in an in-memory map
(`index.ts`) rather than discovered from the filesystem, so the compiled `dist/`
output needs no directory scanning under ESM.

Rules:

- Migration names are `NNNN_snake_case_description`; Kysely applies them in
  lexical order and records applied names in `kysely_migration`.
- Every migration has a `down`. `resetDatabase` unwinds to `NO_MIGRATIONS` and
  re-applies, so a complete `down` path is exercised on every local reset.
- A migration that has merged to `main` is never edited, renamed, or removed.
  Schema changes are new migrations. Schema state is therefore fully described by
  committed code, which satisfies DEV-028's "shared schema changes are
  represented as committed migrations".
- Migrations are an explicit operator step (`make db-migrate`), not run at
  service or container start. Two services share the database, and running
  migrations from each on boot would race. Wiring migrations into CI or a
  dedicated Compose step is a follow-up.
- `make db-reset` is destructive and for local development and test databases
  only. The CLI refuses it when `NODE_ENV=production`.

### One shared database, one migration lineage

For the MVP there is a **single Postgres database (`openreel`) with a single
migration history**, owned by the shared workspace package **`@openreel/db`**
(`packages/db/`). Services depend on that package rather than each carrying
their own schema.

The reference project plan (`docs/reference/project-plan.md` §5.7.1) sketches
separate AppView and feed-generator Postgres instances. That separation is not
adopted now: the team is small, both services index the same firehose, and the
feed generator's aggregate tables are derived from the AppView's index. Sharing
tables across the two services is a known coupling, accepted deliberately. It is
reversible: Kysely has no opinion about how many databases exist, migration
files can be partitioned by table into per-service packages, and nothing in the
`Database` interface assumes a single connection.

### Initial schema

`0001_initial_schema` creates four tables — `actor`, `video_post`,
`watch_event`, and `video_post_stats` — as an index over the records the
AppView will ingest, plus one aggregate table as the seam for feed generators.
Conventions: `snake_case` identifiers, `text` rather than `varchar`,
`timestamptz` for all times, AT-URIs and DIDs as primary keys, and an
`indexed_at` column distinct from the record's own `created_at`. Column names
are generic and will track the `social.openreel.*` Lexicons once those merge.

## Alternatives considered

| Option | Why not |
|---|---|
| Drizzle ORM + drizzle-kit | Strong TypeScript story and a schema-as-code model, but its migration generation diffs a declarative schema and emits SQL, which is a second artifact to review and can produce surprising diffs. Not what the `@atproto` implementations use, so upstream code stops being a direct reference. |
| Prisma | Schema DSL plus a Rust query engine binary and its own client generation step. Heaviest option; the ORM object model gets in the way of index-style tables and hand-tuned queries, and the engine binary complicates Alpine container images. |
| `node-pg-migrate` or `dbmate` | Solid SQL-first migration tools, but they only solve migrations. The query layer would still be raw `pg` with untyped rows, or a second dependency alongside them. Kysely's migrator gives both in one package. |
| Raw `pg` with hand-written SQL and a home-grown migration runner | Zero abstraction, but every query returns `any`, and a migration runner with locking, ordering, and down support is exactly what Kysely already ships. |
| Kysely `FileMigrationProvider` | The built-in filesystem provider works, but under ESM + `tsc` it needs `import.meta.dirname` plumbing and a `.js`-suffixed file filter; an explicit map is simpler, works identically in `src/` and `dist/`, and makes the ordered list visible in one place. |
| `kysely-codegen` for the `Database` interface now | Adds a dependency and a generation step to keep in sync for four tables. Revisit when hand-maintenance becomes error-prone. |
| Per-service databases from the start | Requires deciding table ownership before any service has a query, and doubles the migration and Compose surface. Deferred; see "Revisit if". |

## Consequences

- Every schema change is a TypeScript file in `packages/db/src/migrations/`,
  reviewed like any other code and typechecked by `make check`.
- Services get a typed `Kysely<Database>` and share one connection-pool factory.
  Neither `appview` nor `feedgen` depends on `@openreel/db` yet; adding the
  dependency will also require the service Dockerfiles to `COPY
  packages/db/package.json` alongside `packages/service-core/package.json`,
  since they copy manifests explicitly for layer caching.
- The `Database` interface is hand-written and can drift from the migrations.
  The integration test (`TEST_DATABASE_URL`-gated) inserts and selects through
  the typed layer after migrating, which catches the common drift cases.
- `appview` and `feedgen` share tables. A change to a shared table must consider
  both readers, and the two services cannot be deployed against different
  schema versions.
- This ADR resolves the "Database access layer" item under ADR-0002's
  "Unresolved" list. ADR-0002 itself is unchanged.
- Reversal cost: swapping the query builder is a per-query rewrite but leaves
  the schema and migration history intact; Kysely migrations are plain
  functions that can be replayed by another runner. Splitting the database is a
  data migration plus a repartition of the migration files.

## Revisit if

- The AppView and feed generator need to scale, deploy, or be operated
  independently, in which case split the database along table ownership lines.
- The `social.openreel.*` Lexicons merge with fields that the initial schema
  cannot represent additively, or the schema grows to the point where
  hand-maintaining `Database` is error-prone (adopt `kysely-codegen`).
- The `@atproto` reference implementations move off Kysely, weakening the
  "match upstream" rationale.
- A workload needs features outside Kysely's Postgres dialect that are painful
  through `sql` template escapes.
