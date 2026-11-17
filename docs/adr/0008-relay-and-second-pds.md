# ADR-0008: Upstream relay and a second PDS on the AWS host

- **Status:** Proposed
- **Date:** 2026-11-16
- **Deciders:** Zack Murry (proposed; for team review)

## Context

The project plan's sprint 7 task "test records from multiple PDSs and migrate
a test account" is the demonstration of what AT Protocol is for: identity and
data that do not belong to one server. Today the AppView cannot see it. Its
Jetstream reads `subscribeRepos` from our one PDS (ADR-0006), so a video
posted on any other PDS never reaches the index, and an account that migrates
away disappears from it.

ADR-0002 left open "whether OpenReel operates its own relay or consumes an
upstream firehose". This forces that decision.

Constraints found while investigating (upstream `indigo/cmd/relay` at
`a39b2f9`):

- The relay is built for the public network. Before crawling a host, even when
  told to by its admin API, it calls `describeServer` through a public-only
  HTTP transport: private addresses and ports other than 80/443 are refused,
  and hostnames must be dotted names without ports. It cannot crawl `pds:3000`
  on a Docker network, so it cannot run in the local Compose stack without
  patching it or editing its database.
- It enforces what migration needs: an event only counts if the account's DID
  document names the host it arrived from, so after a move the new PDS's
  events are accepted and the old PDS's are dropped.
- Accounts live in our private PLC (ADR-0005, ADR-0007). A second PDS that
  also registers there is reachable to everything we run; Bluesky's PDSs use
  the public `plc.directory`, which is #122's separate question.

## Decision

On the AWS host only:

- **Run the upstream relay** (`ghcr.io/bluesky-social/indigo:relay-<sha>`,
  pinned) as a Compose service with SQLite state in its own volume, resolving
  DIDs against our private PLC. Jetstream reads the relay instead of the PDS.
  The relay is not exposed publicly; its admin API is on the host's loopback
  and takes the PDS admin password, like the AppView's admin method.
- **Crawl an allowlist** of our PDS hostnames, requested through the relay's
  admin API on every deploy (idempotent). Each is marked trusted so the
  default 100-account limit per host does not apply. PDSs do not self-announce
  (`PDS_CRAWLERS` stays unset).
- **Run a second upstream PDS**, `pds2`, at its own hostname
  (`pds2.dev.openreel.social`) with its own secrets and volume, registering
  DIDs in the same private PLC. It is optional: without `PDS2_HOSTNAME` the
  host runs as before, plus the relay.
- **Migrate accounts with the protocol's own flow** (`scripts/migrate-account.mjs`,
  the sequence `goat account migrate` uses), so DIDs, records, and blobs move
  and the PLC document is updated. No OpenReel service needs to know an
  account moved.

The local Compose stack keeps a single PDS read directly by Jetstream.

## Alternatives considered

| Option | Why not |
|---|---|
| One Jetstream per PDS, the AppView checking each account's current PDS itself | Works locally too, but reimplements the relay's host check in our code, and every PDS we add is another subscription to operate. |
| The relay locally as well, on the host network with seeded host rows | Depends on relay internals, and host networking does not work in Docker Desktop on the team's Macs. |
| Bluesky's public relay (`bsky.network`) | The whole network's firehose on an 8 GB host, and it only carries accounts in the public `plc.directory`. |
| Patch the relay to allow private hosts | A fork to maintain for a test topology. |

## Consequences

- Records from any allowlisted PDS reach the AppView, feed generator, and
  media worker with no change to their code; posts keep their AT-URIs and
  renditions their `(DID, blob)` keys across a migration.
- Federation can only be exercised on AWS. Local development cannot reproduce
  a multi-PDS or migration bug; it needs the shared host.
- The relay's host check goes out to the public hostname and back
  (hairpinning through the host's own public IP and nginx). If the public
  hostname is down, so is ingest.
- Switching Jetstream's upstream resets its event sequence, so Jetstream
  starts with a fresh volume (`jetstream-relay-data`). The AppView's cursor is
  Jetstream's own clock, so it carries over; nothing already indexed is lost.
  A newly crawled host starts at its current position, not its history.
- One more pinned upstream image to track, and two more volumes (`relay-data`,
  `pds2-data`) to back up. The backup scripts cover only the first PDS for now.
- `pds2` needs a DNS record and three more secrets before it starts; until
  then it is simply not run.

## Revisit if

- PDSs outside our control (public hostnames) should be indexed: the relay
  already handles that, but crawling arbitrary hosts needs a policy.
- Bluesky interop (#122) brings in the public `plc.directory`.
- Local multi-PDS testing becomes necessary, which would reopen the
  per-PDS-Jetstream option.
