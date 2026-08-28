# OpenReel Agent Instructions

This file is the canonical repository-level guidance for coding agents working on OpenReel. It is also intended to be useful to human contributors.

OpenReel is an open-source, video-first social platform built on the AT Protocol. The project aims to preserve user-owned identity and data portability while adding video-native engagement signals, user-selectable recommendation feeds, performant short-form video playback, and stackable moderation.

The primary client is a native iOS application. The broader architecture is service-oriented and federated, with Personal Data Servers (PDSs), Relay/Firehose infrastructure, AppView services, feed generators, moderation/labeling services, media storage/delivery, and supporting data infrastructure evolving as the implementation matures.

## Before You Change Anything

1. Read the assigned GitHub issue or task in full.
2. Inspect the files you intend to modify and their nearby conventions.
3. Read relevant accepted ADRs under `docs/adr/`.
4. If working on a public protocol contract, inspect the relevant Lexicons before changing behavior.
5. Check for a nearer `AGENTS.md`; more specific instructions may add to or override this file for that subtree.
6. Do not assume that a design detail in the large project documentation is still current if newer ADRs, code, tests, or task requirements disagree.

If requirements remain materially ambiguous after checking the repository sources, surface the ambiguity rather than silently inventing a design.

## Sources of Truth

Different sources are authoritative for different questions:

- **Assigned GitHub issue / task:** defines the requested outcome, scope, dependencies, and acceptance criteria.
- **Accepted ADRs (`docs/adr/`):** govern architectural and other durable technical decisions.
- **Published Lexicons / protocol contracts:** govern externally visible AT Protocol schemas and compatibility expectations.
- **Current code, tests, and configuration:** define implemented behavior.
- **Project documentation report:** provides broad product, research, and architecture context, but some implementation details may be stale as the project evolves.
- **Chat messages, old comments, and informal notes:** useful context, but not durable project truth unless captured in an issue, ADR, code, test, or other repository artifact.

When these sources conflict, do not silently choose one. Determine whether they govern different concerns; otherwise flag the conflict in the issue or PR.

### Known superseded documentation

Accepted ADR-0001 supersedes older project-document references to the `io.openreel.*` namespace.

Current decisions are:

- Domain: `openreel.social`
- Lexicon namespace: `social.openreel.*`
- iOS bundle identifier: `social.openreel.ios`
- GitHub organization: `OpenReelSocial`

Do not introduce new `io.openreel.*` identifiers.

The project documentation also currently contains inconsistent Cloudflare/CloudFront wording. Until an accepted ADR or implementation decision resolves that inconsistency, do not treat either CDN choice as authoritative merely because one appears in a particular section.

## Repository Shape

The repository is a monorepo. The intended major areas are reflected by repository ownership rules and will appear as real files are added:

- `apps/ios/` — native iOS client
- `services/appview/` — AppView/indexing and hydration
- `services/feedgen/` — feed generation
- `services/relay/` — Relay/Firehose-related work
- `services/pds/` — PDS integration/configuration
- `services/labeler/` — moderation/labeling
- `services/classifier/` — automated content classification
- `services/gateway/` — client/backend integration gateway where applicable
- `packages/lexicons/` — OpenReel AT Protocol Lexicons
- `infra/` — deployment and infrastructure-as-code
- `docs/adr/` — architecture decision records

Do not create empty directory trees purely to make the intended structure visible. Git tracks files, not directories; add directories when real content belongs there.

## Architectural Intent

Treat the following as broad project intent, not permission to implement speculative infrastructure:

- AT Protocol is the interoperability and identity foundation.
- User identity and portable records are anchored in PDSs.
- Relay/Firehose infrastructure distributes repository events to downstream services.
- AppView provides indexing, aggregation, hydration, filtering, and related read-side behavior.
- Feed generators rank or select content independently from storage ownership.
- OpenReel is intended to support user-selectable recommendation algorithms rather than one mandatory opaque feed.
- The iOS client is a reference client, not the owner of user identity.
- Video delivery is performance-sensitive and intentionally separated from lightweight protocol metadata.
- Moderation is intended to combine baseline platform safety, interoperable labeling, and automated video classification.
- Service boundaries should stay clear, but early development does not require every logical service to become an independently operated production deployment.

Prefer adapting the architecture as evidence arrives over prematurely building production-scale infrastructure.

## AT Protocol and Lexicon Rules

Lexicons are public protocol contracts, not ordinary internal types.

When working with OpenReel Lexicons:

- Use the accepted `social.openreel.*` namespace.
- Preserve interoperability with AT Protocol-compliant implementations.
- Do not rename, remove, or repurpose published fields casually.
- Do not hand-edit generated bindings when a generation workflow exists.
- Treat compatibility changes as requiring deliberate review.
- If a change appears breaking or changes a durable protocol decision, surface it for human review and update/add an ADR when appropriate.

A more specific `packages/lexicons/AGENTS.md` may add stricter rules once the Lexicon workspace is established.

## Working Style

OpenReel is being developed iteratively. Keep changes narrow, reversible, and easy to review.

For each task:

- Work on one clearly scoped issue/task at a time.
- Use a short-lived branch or isolated worktree where practical.
- Do not modify unrelated files for opportunistic cleanup.
- Match existing conventions before introducing new abstractions.
- Prefer the smallest implementation that satisfies the acceptance criteria and preserves a clean upgrade path.
- Do not introduce a new framework, database, queue, deployment platform, major infrastructure primitive, or protocol pattern merely because it is locally convenient. Check existing ADRs and raise the architectural decision when necessary.
- Do not rewrite a working area into a preferred style unless the task calls for it.

If multiple agents are working concurrently, avoid overlapping edits to shared hotspot files such as lockfiles, workspace manifests, Compose configuration, Lexicons, XcodeGen configuration, and infrastructure stacks unless the work has been intentionally coordinated.

## Git and Pull Requests

The intended workflow is trunk-oriented with short-lived branches and review through pull requests.

- Do not push directly to `main` unless a maintainer explicitly asks for that exception.
- Prefer one task/issue per branch.
- Prefer clear branch names such as `feature/42-appview-health` or `fix/81-player-audio`.
- Keep commits and diffs focused.
- Follow `CODEOWNERS` and request the appropriate reviewers for sensitive areas.
- Explain consequential design choices in the PR.
- Add or update an ADR when a durable architectural decision changes.
- Do not encode whether the author was a human or agent in normal branch naming; the task is the organizing unit.

A good PR description should state:

- what changed,
- why,
- how it was validated,
- important risks or tradeoffs,
- whether architecture, infrastructure, or Lexicons changed,
- unresolved follow-up work.

## Verification

Use the repository's checked-in commands as they become available. Do not invent commands and present them as if they already work.

At the time this file was introduced, the full developer toolchain and canonical `make check` workflow were still being established. Inspect the root `Makefile`, package scripts, CI workflows, and component documentation before running or documenting commands.

Once a canonical validation command exists, it should be the default pre-PR verification path for both humans and agents.

General rules:

- Run the narrowest relevant tests while iterating.
- Run the repository's canonical pre-PR checks before declaring a task complete once those checks exist.
- Add or update tests for behavior-changing code where appropriate.
- For cross-service changes, prefer real integration coverage at the affected boundary rather than relying only on mocks.
- Never delete, weaken, skip, or rewrite a test/check merely to make CI pass unless the test/check itself is demonstrably wrong and correcting it is part of the task.
- If required validation cannot be run, say exactly what was not run and why.

## iOS Conventions

The repository `.gitignore` establishes that Xcode project/workspace files are generated rather than committed.

- Do not commit generated `.xcodeproj` files.
- Use the repository's Xcode generation workflow once it exists.
- Keep build and test behavior automatable from the command line so CI and coding agents can reproduce it.
- Prefer native iOS technologies where they fit the product requirements; the project design currently centers on Swift/SwiftUI and AVFoundation/HLS for the reference client.
- Do not bury networking, playback state, protocol handling, or business logic directly in presentation code when a clearer separation is available.

A more specific `apps/ios/AGENTS.md` may add details once the iOS structure stabilizes.

## Infrastructure and Deployment

Infrastructure should become reproducible and reviewable through infrastructure-as-code rather than manual console-only configuration.

Until the infrastructure workflow is established:

- Do not invent production deployment procedures.
- Do not create cloud resources simply because a design document mentions them.
- Do not expose storage, databases, or services publicly without a documented requirement.
- Prefer least-privilege identities and short-lived credentials.
- Ordinary coding agents should not require persistent production credentials.
- Shared/cloud deployments should ultimately flow through reviewed CI/CD rather than arbitrary local agent actions.

When `infra/AGENTS.md` exists, follow its stricter infrastructure-specific rules.

## Security and Secrets

Never commit or expose credentials, signing keys, tokens, private certificates, recovery keys, production connection strings, or other secrets.

- Use `.env.example` only for non-secret examples/placeholders.
- Keep real local secrets in ignored files or an approved secret-management mechanism.
- Do not print secret values into logs, test snapshots, issues, or PR descriptions.
- Do not weaken authentication, authorization, signature validation, transport security, or moderation safeguards merely to simplify local development.
- Treat AT Protocol identity/signing behavior as security-sensitive.
- If a task requires access or a destructive operation beyond the agent's permissions, stop at the safe boundary and clearly report the required human action.

## External and Destructive Actions

Reversible repository edits are lower risk than operations affecting shared systems.

Unless explicitly requested and appropriately authorized, do not:

- deploy to production,
- delete shared cloud infrastructure,
- mutate production databases,
- rotate or reveal credentials,
- publish breaking Lexicons,
- merge your own PR,
- bypass required review or CI,
- perform destructive account/data migrations.

Prefer preparing reviewed code/configuration that lets the normal human/CI process perform external changes.

## Documentation and ADRs

Keep durable decisions durable.

Use ADRs when a change establishes or replaces a meaningful architectural decision, such as:

- major infrastructure choices,
- persistence or queue technologies,
- protocol/namespace decisions,
- service boundary changes,
- externally visible compatibility decisions,
- deployment patterns that constrain future work.

Do not create ADRs for ordinary implementation details that are easy to change and do not constrain the architecture.

The large OpenReel project documentation is an important design/reference source, but the project is intentionally agile. When implementation evidence or an accepted ADR supersedes a document detail, prefer updating the durable decision rather than preserving an outdated implementation assumption.

## Definition of Done

A task is complete when, as applicable:

- the requested behavior is implemented within scope,
- acceptance criteria are satisfied,
- relevant tests and validation pass,
- generated artifacts are current,
- public/protocol compatibility has been considered,
- no secrets or accidental generated/local files are included,
- documentation or ADRs are updated when the change alters durable behavior or architecture,
- the diff has been reviewed for unrelated changes,
- remaining risks, blockers, or unrun validation are explicitly reported.

Do not claim completion if a required acceptance criterion or verification step is still known to be missing.
