# Repository structure

OpenReel is a single monorepo covering the iOS client, backend services, AT
Protocol Lexicons, and infrastructure.

This document is the canonical description of the layout. Directories are **not**
created ahead of real content — `AGENTS.md` forbids placeholder trees and Git does
not track empty directories — so this document, not the working tree, is where the
intended shape lives. `.github/CODEOWNERS` already encodes ownership for paths
that do not exist yet; treat the two together as the contract.

Technology choices referenced here are recorded in
[ADR-0002](../adr/0002-foundational-technology-stack.md). Backlog task IDs refer
to `docs/dev-environment-tasks.yaml`.

## What exists today

```text
openreel/
├── apps/                      # (not yet created)
├── packages/
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
│   ├── admin/                 # internal status page, loopback-bound only
│   └── pds/                   # upstream PDS: config + ops, no app code
│       ├── compose.yaml       #   overlay, layered by 'make up-atproto'
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
| `packages/lexicons/` | `social.openreel.*` Lexicon JSON and generated bindings | E4-01 |
| `infra/` | Not started. AWS CDK v2 TypeScript app plus `infra/AGENTS.md` | DEV-048/049 |
| `services/gateway/` | Client/backend gateway, **if** the boundary proves necessary | — |
| `services/labeler/` | Moderation labeling service | — |
| `services/relay/` | Relay/firehose configuration; upstream implementation | — |
| `services/pds/` | PDS configuration beyond the Compose service | — |
| `services/classifier/` | Python + Ruff + pytest; its own `pyproject.toml` | DEV-035 |
| `services/*/Dockerfile`, `.dockerignore` | Per-service container builds | DEV-023/024 |
| `patches/` | pnpm patch files, only once one is actually needed | — |

## Conventions

**Operated vs. authored services.** `services/` holds both. `appview`, `feedgen`,
and `admin` are OpenReel code. `pds` is the upstream `bluesky-social` image, so its
directory holds configuration, a Compose overlay, and operational scripts rather
than application code. `relay` is expected to follow the same pattern.

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
| `docker-compose.yml` + `.dev.yml` | `compose.yaml` + `services/pds/compose.yaml` | Two files, as in the reference. Compose interpolates every service in a file regardless of profile, so the PDS's required-variable guards must live in a separate overlay that a plain `make up` never parses |
| `.env.op-local`, `.env.op-prod` | `.env.example` + ignored `.env` | No secret-manager integration chosen yet |
| `AGENTS.md`, `README.md` | same | Adopted |
| `CLAUDE.md` | `CLAUDE.md` | A one-line `@AGENTS.md` import, so Claude Code picks up the same instructions without a second copy to keep in sync |
| `PROJECT_README_FOR_LLMS.md` | — | `AGENTS.md` already fills this role |
| `.agents/skills`, `.claude`, `.codex`, `.mcp.json`, `.claudeignore`, `.ignore` | — | Not adopted; agent guidance is tool-neutral in `AGENTS.md` and `docs/agent/` |
| `.ebextensions`, `.platform/`, `Dockerrun.aws.json`, root `Dockerfile` | — | Elastic Beanstalk. OpenReel deploys via CDK to ECR/ECS with per-service Dockerfiles (DEV-048/051) |
| `.pre-commit-config.yaml` | — | Python-oriented; a TypeScript hook runner is unresolved in ADR-0002 |
| `customers`, `knowledge_graph`, `plugins`, `experiments` | — | No analogue in this product |
