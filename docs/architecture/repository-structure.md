# Repository structure

OpenReel is a single monorepo covering the iOS client, backend services, AT
Protocol Lexicons, and infrastructure.

This document is the canonical description of the layout. Directories are **not**
created ahead of real content — `AGENTS.md` forbids placeholder trees and Git does
not track empty directories — so this document, not the working tree, is where the
intended shape lives. `.github/CODEOWNERS` already encodes ownership for paths
that do not exist yet; treat the two together as the contract.

Technology choices referenced here are recorded in
[ADR-0002](../adr/0002-foundational-technology-stack.md); the database access
layer and migration tooling in
[ADR-0003](../adr/0003-database-access-and-migrations.md). Backlog task IDs
refer to `docs/dev-environment-tasks.yaml`.

## What exists today

```text
openreel/
├── apps/                      # (not yet created)
├── packages/
│   ├── db/                    # Kysely + pg, shared schema + migrations     DEV-028
│   │   ├── src/
│   │   │   ├── database.ts    #   Database table types, createDb()/closeDb()
│   │   │   ├── migrations/    #   NNNN_*.ts, registered in index.ts
│   │   │   ├── migrate.ts     #   migrateToLatest(), resetDatabase(), status
│   │   │   └── cli.ts         #   'node dist/cli.js migrate|reset|status'
│   │   └── test/              #   unit tests + TEST_DATABASE_URL-gated integration
│   ├── lexicons/              # social.openreel.* Lexicons + bindings   DEV-030..033
│   │   ├── lexicons/
│   │   │   ├── social/openreel/  # OpenReel Lexicon JSON, one file per NSID
│   │   │   └── com/atproto/      # upstream Lexicons vendored verbatim for refs
│   │   ├── scripts/lex.ts     #   validate / generate / check ('make lex')
│   │   ├── src/index.ts       #   public surface of @openreel/lexicons
│   │   ├── src/generated/     #   @atproto/lex-cli output, committed, never edited
│   │   ├── test/              #   contract tests: valid and invalid records
│   │   └── AGENTS.md          #   scoped rules: contracts, compatibility, codegen
│   └── service-core/          # shared Express app, health route, config  DEV-020
├── services/
│   ├── appview/               # Express 5 + TypeScript, GET /health          DEV-016
│   │   ├── src/
│   │   │   ├── app.ts         #   createApp() — routes, no port binding
│   │   │   └── index.ts       #   process entrypoint
│   │   ├── test/              #   Vitest, in-process via supertest          DEV-017
│   │   ├── Dockerfile         #   multi-stage, non-root                     DEV-023
│   │   ├── tsconfig.json      #   editor/ESLint/typecheck project (no emit)
│   │   ├── tsconfig.build.json#   build project (src -> dist)
│   │   ├── vitest.config.ts
│   │   └── .env.example
│   ├── feedgen/               # same shape                             DEV-018/024
│   └── admin/                 # internal status page, loopback-bound only
├── infra/
│   └── pds/                   # upstream PDS: config + ops, no app code
│       ├── compose.yaml       #   overlay, layered in by 'make up'
│       ├── scripts/           #   generate-secrets.sh
│       └── .env.example
├── docs/
│   ├── adr/                   # architecture decision records
│   ├── architecture/          # current intended design (this file)
│   ├── agent/                 # contributor + agent workflow
│   ├── reference/             # imported, non-canonical context
│   └── dev-environment-tasks.yaml
├── scripts/
│   ├── github/                # backlog seeding
│   └── status.sh              # terminal renderer for the admin status API
├── .github/                   # templates, CODEOWNERS, workflows
├── .vscode/
├── AGENTS.md                  # canonical agent + contributor instructions
├── CLAUDE.md                  # `@AGENTS.md` import, not a second copy
├── Makefile                   # canonical command interface
├── compose.yaml               # Postgres, Redis, appview, feedgen,   DEV-021/022
│                              #   admin — the default stack
├── package.json               # workspace root, pins Node + pnpm            DEV-006
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json         # strict shared base                          DEV-007
├── eslint.config.mjs          # flat config, type-aware                     DEV-008
├── .prettierrc.json
├── .nvmrc
└── .env.example                                                             DEV-010
```

## Intended additions

Each appears when the owning task is implemented.

| Path | Contents | Task |
| --- | --- | --- |
| `apps/ios/` | SwiftUI client; `project.yml` for XcodeGen, generated `.xcodeproj` stays uncommitted | DEV-013/014 |
| `apps/ios/Packages/OpenReelNetworking/` | Swift package for protocol + API access | — |
| `apps/ios/Packages/OpenReelPlayer/` | Swift package for AVFoundation/HLS playback | — |
| `infra/*.ts`, `infra/lib/` | AWS CDK v2 TypeScript app plus `infra/AGENTS.md`. Not started | DEV-048/049 |
| `services/gateway/` | Client/backend gateway, **if** the boundary proves necessary | — |
| `services/labeler/` | Moderation labeling service | — |
| `infra/relay/` | Relay/firehose configuration, if OpenReel operates one. Upstream implementation, so it belongs beside `infra/pds/` | — |
| `services/classifier/` | Python + Ruff + pytest; its own `pyproject.toml` | DEV-035 |
| `services/*/Dockerfile`, `.dockerignore` | Per-service container builds | DEV-023/024 |
| `patches/` | pnpm patch files, only once one is actually needed | — |

## Conventions

**Operated vs. authored components.** `services/` holds code OpenReel writes —
`appview`, `feedgen`, `admin`. Components the project runs but does not author live
under `infra/` instead, because what we own for them is deployment configuration
and operational tooling rather than source. `infra/pds/` is the first: a Compose
overlay, an `.env.example`, and a secret-generation script wrapped around the
upstream `bluesky-social` image. A relay, if OpenReel operates one, belongs there
too. `infra/` therefore covers both infrastructure-as-code and the configuration
for operated third-party components.

**Service internals.** Every backend service exposes `createApp()` in
`src/app.ts` returning a configured Express app without binding a port, and
`src/index.ts` as the process entrypoint. Tests exercise `createApp()` in
process. This keeps `GET /health` and every later route testable without sockets
and confines the HTTP framework to one replaceable seam.

**TypeScript projects.** Two configs per package: `tsconfig.json` covers `src`,
`test`, and config files with `noEmit` (used by editors, ESLint's type-aware
rules, and `typecheck`); `tsconfig.build.json` compiles `src` to `dist`. Both
extend the root `tsconfig.base.json`.

**Naming.** Workspace packages are `@openreel/<dir>`. Directory names are lower
case with no separators (`appview`, `feedgen`) to match the existing CODEOWNERS
paths and AT Protocol service vocabulary.

**Documentation does not live beside code.** There are no per-directory
`README.md` files inside `services/` or `packages/`. Structural and boundary
documentation belongs in `docs/architecture/`; instructions for agents belong in
`AGENTS.md` or a scoped `AGENTS.md` for a subtree.

**Configuration.** Root `.env.example` holds shared local infrastructure values;
each service carries its own `.env.example` for settings only it consumes. Real
`.env` files are git-ignored. Variables are `<COMPONENT>_<SETTING>` in upper snake
case.

**Commands.** `make` is the stable interface for humans, CI, and agents;
`make check` is the pre-PR gate. `pnpm` and `turbo` are implementation details
behind it, and only working targets are exposed.

`make lex` validates every Lexicon document under `packages/lexicons/lexicons/`
and regenerates `packages/lexicons/src/generated/`; run it after editing any
Lexicon JSON and commit the output. `make lex-check` performs the same validation
and then regenerates into a temporary directory and compares, failing if the
committed bindings are stale without touching the tree. `make check` includes
`lex-check`. Rules specific to that subtree are in `packages/lexicons/AGENTS.md`.

**Database.** One Postgres database, one migration history, owned by
`packages/db/` (ADR-0003). `make db-migrate` applies pending migrations,
`make db-status` lists them, and `make db-reset` rolls every migration back and
re-applies them — destructive, local only, and refused under
`NODE_ENV=production`. All three read `DATABASE_URL` from the environment, then
`.env`, then derive it from the `POSTGRES_*` values so it matches the Compose
database from the host. Migrations are an explicit step; no service or
container runs them on start. Schema changes are new files under
`packages/db/src/migrations/`, never edits to merged ones. The integration test
in `packages/db/test/` runs only when `TEST_DATABASE_URL` is set, so
`make test` needs no database.

`make up` is the whole stack — Postgres, Redis, AppView, Feed Generator, admin,
and the PDS — and finishes by printing the status report, so one command both
starts the system and shows whether it came up. `make up-core` omits the PDS for
work that does not need it; the status page then reports the PDS down, which is
expected rather than a failure. `make down` passes `--remove-orphans` so it also
stops the PDS, which is an orphan relative to the root `compose.yaml`.

## Relationship to the reference layout

This structure was adapted from an existing Python-oriented monorepo. The mapping
below records what was adopted, renamed, or dropped, so the divergences are
deliberate rather than accidental.

| Reference | OpenReel | Note |
| --- | --- | --- |
| `apps`, `docs`, `infra`, `services`, `.github`, `.vscode` | same | Adopted directly |
| `schemas` | `packages/lexicons/` | Schemas here are public AT Protocol contracts, not internal types |
| `entities` | `packages/` | Shared TypeScript packages |
| `proxy` | `services/gateway/` | Existing `AGENTS.md` name; may not be needed |
| `py_utils` | `services/classifier/` | Python stays inside the one service that needs it |
| `processing` | — | Media/transcode pipeline; no owning task yet |
| `tools`, `dev` | `scripts/` | Folded together rather than three overlapping directories |
| `biome.json` | `.prettierrc.json`, `eslint.config.mjs` | Per ADR-0002 |
| `pyproject.toml`, `uv.lock` | `package.json`, `pnpm-lock.yaml` | A `pyproject.toml` appears under `services/classifier/` later |
| `docker-compose.yml` + `.dev.yml` | `compose.yaml` + `infra/pds/compose.yaml` | Two files, as in the reference. Compose interpolates every service in a file regardless of profile, so the PDS's required-variable guards must live in a separate overlay that a plain `make up` never parses |
| `.env.op-local`, `.env.op-prod` | `.env.example` + ignored `.env` | No secret-manager integration chosen yet |
| `AGENTS.md`, `README.md` | same | Adopted |
| `CLAUDE.md` | `CLAUDE.md` | A one-line `@AGENTS.md` import, so Claude Code picks up the same instructions without a second copy to keep in sync |
| `PROJECT_README_FOR_LLMS.md` | — | `AGENTS.md` already fills this role |
| `.agents/skills`, `.claude`, `.codex`, `.mcp.json`, `.claudeignore`, `.ignore` | — | Not adopted; agent guidance is tool-neutral in `AGENTS.md` and `docs/agent/` |
| `.ebextensions`, `.platform/`, `Dockerrun.aws.json`, root `Dockerfile` | — | Elastic Beanstalk. OpenReel deploys via CDK to ECR/ECS with per-service Dockerfiles (DEV-048/051) |
| `.pre-commit-config.yaml` | — | Python-oriented; a TypeScript hook runner is unresolved in ADR-0002 |
| `customers`, `knowledge_graph`, `plugins`, `experiments` | — | No analogue in this product |
