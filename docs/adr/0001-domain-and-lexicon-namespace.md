# ADR-0001: Domain and Lexicon namespace

- **Status:** Accepted
- **Date:** 2026-08-26
- **Deciders:** AndrewLHellman

## Context

AT Protocol identifies every record type and API endpoint by a Namespaced
Identifier (NSID) in reverse-DNS format — `app.bsky.feed.post`, for example.
The convention is that a developer publishes Lexicons under a namespace derived
from a domain they control.

OpenReel defines custom record types for video posts and video-native engagement
signals, so the project needs a registered domain before any Lexicon is authored.

Two constraints made this urgent rather than incidental:

1. **Records are immutable.** Once a record is written to the network under a
   given NSID, it cannot be retroactively rewritten. The namespace has to be
   correct before the first record is published, not after.
2. **The project documentation specified `io.openreel.*`**, which implies
   ownership of `openreel.io`. That domain is unavailable.

## Decision

- **Domain:** `openreel.social` (registered)
- **Lexicon namespace:** `social.openreel.*`
- **Bundle identifier:** `social.openreel.ios`
- **GitHub organisation:** `OpenReelSocial`

Initial record types:

```
social.openreel.video.post
social.openreel.engagement.watchEvent
social.openreel.engagement.completionRate
social.openreel.feed.generator
```

## Alternatives considered

| Option | Why not |
|---|---|
| `openreel.io` | Unavailable |
| `openreel.app` / `openreel.video` | Available, but `.social` states what the project is and matches AT Protocol ecosystem convention (`bsky.app`, `deer.social`, `tangled.sh`) |
| Namespace not derived from an owned domain | Violates the reverse-DNS convention and would break interoperability expectations for other implementations reading our records |

## Consequences

- Sections 4.1.6.2, 4.6.4, and 5.4.3 of the project documentation reference
  `io.openreel.*` and must be updated to `social.openreel.*` before task E4-01.
- The domain registration is load-bearing. Auto-renew is enabled; a lapse would
  invalidate the namespace claim for every record already published.
- `openreel.social` must resolve before handle verification and PDS deployment
  (task E10-04), though the namespace claim itself is satisfied by ownership.

## Revisit if

The project moves to a different domain, in which case every published record
under `social.openreel.*` would need to be considered permanent legacy rather
than migrated.
