# ADR-0010: Serving feeds from third-party feed generators

- **Status:** Proposed
- **Date:** 2026-11-17
- **Deciders:** Gabe Edwards (proposed; for team review)

## Context

The project plan's Algorithm Selection requirement is that users can choose
feeds rather than be locked into one, including feeds someone else runs
(plan 3.1, 3.2.1; "a user who dislikes the default feed algorithm can
subscribe to a third-party one"). Until now the AppView sent every
`getFeedSkeleton` to the one generator in `FEEDGEN_URL`, so a feed URI from
anyone else came back `UnknownFeed` (`docs/architecture/feeds.md`, "Not built
yet").

The iOS app is adding a "My feeds" screen where a viewer types a domain to add
someone else's feeds. That needs two things the stack did not have:

- a way to go from a feed URI to the host that serves it, and
- a way for the AppView to make a request to a host a user chose without
  that request being able to reach the private services beside it (Postgres,
  feedgen, the PDS, the cloud metadata endpoint).

Constraints:

- Feed generator records (`social.openreel.feed.generator`) are not published
  yet, by us or anyone. Our own feeds use the bare authority `openreel.social`
  (`FEEDGEN_PUBLISHER`) with no record behind it.
- `@openreel/service-core`'s `PlcResolver` deliberately does not resolve
  `did:web`, noting it "needs an SSRF-protected client, which is left for when
  it is needed".
- The upstream relay solves the same problem with a public-only HTTP transport
  (ADR-0008).

## Decision

- **Resolve a feed's host from its URI's authority.** A domain authority
  (`at://feeds.example.com/social.openreel.feed.generator/cats`) is served at
  `https://feeds.example.com`; `did:web:feeds.example.com` likewise. Other
  DID methods (`did:plc`) are refused for now. This matches how our own feeds
  are named today and needs no records to exist.
- **Route in the AppView** (`RoutingSkeletonSource`). Authorities our feedgen
  publishes under (the default feed's, plus any in its
  `describeFeedGenerator`) go to `FEEDGEN_URL` as before. Anything else goes
  to its own host's `social.openreel.feed.getFeedSkeleton`. `getFeed` is
  unchanged for clients; no Lexicon changes.
- **Fetch external hosts only over a public-only client** (`public-http.ts`):
  HTTPS on port 443, hostnames only (no IP literals, no `localhost`, `.local`,
  `.internal`), every resolved address must be public unicast (checked in the
  socket's own DNS lookup, so rebinding cannot swap the address after the
  check), no redirects, a 5 s deadline and a 1 MB body cap. The skeleton is
  validated against the Lexicon and trimmed to the requested `limit`.
- **Hydrate as for our own feeds.** The AppView turns the skeleton into posts
  from its own index, so an external generator can only choose and order
  videos this AppView has indexed, has playable media for, and has not taken
  down. It cannot add content or bypass moderation.
- **Discovery is client-side.** The app calls
  `social.openreel.feed.describeFeedGenerator` on the domain the viewer typed
  and keeps only feeds whose URI authority is that domain (or its `did:web`),
  so a host cannot list feeds that would be fetched from a different host.
  The viewer's choices are saved on the device.
- **On by default, with an off switch:** `EXTERNAL_FEEDS=off` makes the
  AppView serve only its own feeds.

## Alternatives considered

| Option | Why not |
|---|---|
| Resolve through generator records (authority's repo → record `did` → DID document → service endpoint), as Bluesky does | The correct end state, but no generator records exist yet, including ours. Can replace authority-as-host later without changing clients. |
| Client fetches the skeleton from the third-party host and hydrates itself | No endpoint hydrates arbitrary post URIs, and it would move moderation and media resolution into the client. |
| AppView endpoint for discovery (new Lexicon) | A Lexicon change for something the existing `describeFeedGenerator` already answers; can be added if clients should not contact generators directly. |
| `@atproto-labs/fetch-node`'s safe fetch | Only a transitive dependency today; adding it changes the shared lockfile. Node's `net.BlockList` and a custom `lookup` cover the same checks. |
| Allowlist of approved generators | Defeats "anyone can run a feed". `EXTERNAL_FEEDS=off` is the blunt version if one is needed. |

## Consequences

- Anyone can run a feed for OpenReel by serving `getFeedSkeleton` and
  `describeFeedGenerator` over HTTPS on their own domain.
- The AppView now makes outbound requests to user-chosen hosts. Each external
  `getFeed` page costs one such request; there is no per-host rate limit or
  cache yet.
- A feed's ranking disclosure (`weights`, `rankingCriteria`) is self-declared
  by its generator and not verified, as for our own feeds.
- Authority-as-host means the publisher and the serving host are the same
  name. Splitting them later (records with a `did` field) is a server-side
  change.
- The viewer's device contacts the domain they typed when looking up its
  feeds, which reveals their IP address to that host.

## Revisit if

- Generator records start being published: switch resolution to records and
  keep authority-as-host only as a fallback, or drop it.
- External feeds see abuse (slow or hostile hosts tying up the AppView): add
  per-host rate limits, caching, or an allowlist.
- Personalized third-party feeds need viewer data (plan tier 2), which changes
  what a generator is sent and needs its own decision.
