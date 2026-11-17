# ADR-0009: Ozone as the baseline labeler and report service

- **Status:** Proposed
- **Date:** 2026-11-17
- **Deciders:** Zack Murry (proposed; for team review)

## Context

The project plan's moderation design (§5.8) has three stackable layers: a
baseline labeler every OpenReel client uses, optional labelers on top, and an
automated classifier whose candidate labels a human confirms "via an
Ozone-compatible interface". Sprint 7 asks for moderation labels, moderator
review, user reports, and filtering preferences.

What exists:

- The iOS client interprets labels on `postView`/`commentView`, sends
  `atproto-accept-labelers: <baseline>;redact`, and files reports with
  `com.atproto.moderation.createReport` through the user's PDS, proxied to the
  baseline labeler once `Backend.baselineLabelerDID` is set
  (`docs/architecture/moderation.md`).
- Takedowns work end to end through `make takedown` (#120, PR #141).
- Nothing receives reports. The PDS has no report service configured, so every
  report fails with "Reporting isn't set up on this server yet." Nothing issues
  labels, and the AppView attaches none.

A labeler is defined by the protocol: a DID whose document has an
`#atproto_labeler` service and an `#atproto_label` signing key, serving
`com.atproto.label.subscribeLabels` and `queryLabels` with signed labels, and
accepting `createReport`. Bluesky's reference implementation is Ozone, which
also provides the moderator review queue and web UI.

Investigation of Ozone (`bluesky-social/ozone` at `f574a6a`, `@atproto/ozone`
0.10.9 as that image pins it) found constraints for our network:

- **Hosting.** One image serves the API and the Next.js moderator UI on one
  port, plus a daemon process for scheduled actions and event pushing. It needs
  Postgres, a public hostname with TLS, and WebSockets. Bluesky recommends
  2 GB RAM. Its guide supports only Caddy as the proxy.
- **Identity.** With `OZONE_SERVER_DID=did:web:<its hostname>`, Ozone serves
  its own `/.well-known/did.json` with both required entries. A `did:plc`
  identity would instead need a PLC operation, which our PDSs can only
  authorize with an emailed token they cannot send. The PLC URL is configurable
  (`OZONE_DID_PLC_URL`), so other DIDs resolve in our private PLC.
- **AppView coupling.** Ozone requires `OZONE_APPVIEW_URL`/`OZONE_APPVIEW_DID`.
  It reads accounts through `com.atproto.admin.getAccountInfos` and records
  through `com.atproto.repo.getRecord`, falling back to the author's PDS only
  when the AppView answers `RecordNotFound`. Our AppView serves neither, so
  reported subjects would show empty in the UI, though reports and labels
  would still work. `app.bsky.*` calls are optional and fail open. The UI
  displays records of any collection as JSON.
- **The published UI image assumes Bluesky's network.** It bakes in
  `NEXT_PUBLIC_PLC_DIRECTORY_URL=https://plc.directory` and Bluesky's handle
  resolver at build time. Its PLC lookups also build an absolute path, so a
  PLC served under a path prefix (ours is `https://dev.openreel.social/plc/`)
  does not work.
- **Takedowns can flow out.** Ozone's daemon can push moderator takedowns to
  the AppView (`OZONE_APPVIEW_PUSH_EVENTS`) and to a PDS (`OZONE_PDS_URL`) as
  `com.atproto.admin.updateSubjectStatus` with service auth.

## Decision

Run upstream **Ozone** on the AWS host as OpenReel's baseline labeler, report
service, and moderator review tool, beside the relay of ADR-0008.

- **Identity and hostname:** `did:web:mod.dev.openreel.social`, served by
  Ozone itself at `https://mod.dev.openreel.social`, behind the host's nginx
  with its own certificate (as for `pds2`). The label signing key is a new
  secret in Parameter Store.
- **Image:** built in our deploy workflow from `bluesky-social/ozone` at a
  pinned commit, with the UI's `NEXT_PUBLIC_*` values pointing at our PLC and
  PDS, and pushed to ECR like our own services. No source patches.
- **PLC at an origin root:** serve the private PLC read-only at
  `https://plc.dev.openreel.social` too, for the UI's browser-side lookups.
  The `/plc/` path stays for existing clients.
- **Storage:** a separate `ozone` database in the existing Postgres container,
  not a new database server.
- **Reports:** the PDSs set `PDS_REPORT_SERVICE_URL`/`DID` (and the matching
  `PDS_MOD_SERVICE_*`) to Ozone, so reports reach it with or without the
  client's proxy header. Moderators are accounts on our PDS listed in
  `OZONE_ADMIN_DIDS`/`OZONE_MODERATOR_DIDS`, signing in to the UI with their
  PDS credentials.
- **AppView changes (ours):**
  1. Serve `com.atproto.admin.getAccountInfos` and `com.atproto.repo.getRecord`
     to Ozone, authenticated by Ozone's service auth. `getRecord` returns the
     indexed record or `RecordNotFound`, so Ozone falls back to the PDS.
  2. Accept Ozone's service auth on `updateSubjectStatus` (today Basic auth
     only), so a takedown in the Ozone UI removes content and renditions
     exactly as `make takedown` does. Ozone also pushes it to the PDS.
  3. Consume Ozone's `subscribeLabels` stream, verify signatures, store labels,
     and attach them to `postView`/`commentView` for the labelers named in
     `atproto-accept-labelers`, omitting `!hide`/`!takedown` content for
     `;redact` labelers. This is the work in `moderation.md` item 4.
- **Client:** set `Backend.baselineLabelerDID` for the AWS backend once the
  above is deployed.
- **Classifier (layer 3):** when it exists, it files candidate labels as
  reports (or as Ozone events) so a moderator confirms them in the same queue.

The local Compose stack does not run Ozone at first. A labeler there needs a
reachable `did:web` hostname, and the iOS client works without one.

## Alternatives considered

| Option | Why not |
|---|---|
| Our own `services/labeler/` (signing, `subscribeLabels`, `queryLabels`, report intake) | Weeks to reach parity on the protocol pieces, and still no moderator UI or review queue, which the plan's layers 1 and 3 both need. |
| `skyware-js/labeler` | A lightweight library without a review UI, and the repository is archived. |
| Ozone with a `did:plc` identity | Needs an emailed PLC token our PDSs cannot send, and gains nothing over `did:web` while we control the hostname. |
| The published Ozone image as is | Its UI resolves DIDs at the public `plc.directory`, so moderators on our private PLC could not use it. |
| No labeler; moderate with takedowns only | Meets #120 but not sprint 7's labels, reports, and review, and leaves the client's moderation UI unused. |

## Consequences

- Reports work for every client and every PDS we run, and moderators get a
  review queue with history, notes, labels, and takedowns.
- One more pinned upstream component, built by us, to track. Its image build
  adds minutes to deploys, and upgrades are deliberate.
- Two more public hostnames (`mod.`, `plc.`) with DNS records and
  certificates, which humans add in Cloudflare.
- Memory on the shared 8 GB host is the main risk. If Ozone does not fit, it
  moves to its own instance, which needs a CDK change.
- Ozone reaches our AppView and PDS, and moderators' PDSs reach Ozone, over
  the public hostname, hairpinning through the host's own public IP, as the
  relay already does (ADR-0008).
- The proxy is nginx, which Bluesky does not officially support for Ozone. It
  needs WebSocket upgrade for `subscribeLabels`, which our other sites already
  configure.
- Label ingestion is new AppView code: a CBOR event-stream consumer with
  signature verification. There is no reference TypeScript consumer to reuse.
- The AppView gains `com.atproto.*` methods authenticated by service auth, the
  first service-to-service authentication it does. Its verification is
  security-sensitive and needs tests.

## Revisit if

- The host cannot hold Ozone's memory, or its image build slows deploys
  unacceptably.
- A labeler must run in local development, for example to test the
  classifier. That reopens `did:web` on localhost.
- Ozone drops the `RecordNotFound` fallback or makes `app.bsky.*` hydration
  mandatory.
- OpenReel moves to the public `plc.directory` (#122), which would make the
  published UI image usable unchanged.
