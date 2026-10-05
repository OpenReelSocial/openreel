# ADR-0004: Client authentication via AT Protocol OAuth

- **Status:** Accepted
- **Date:** 2026-10-05
- **Deciders:** ZackMurry

## Context

OR-019 and OR-027 require the iOS client to sign a user in to their PDS,
resolve their DID and PDS, keep the session alive across launches, sign out,
and behave sensibly when the session expires or the server is unreachable.

AT Protocol offers two ways for a client to authenticate:

1. **`com.atproto.server.createSession`** with the account password or an app
   password. Simple, but the client handles the user's credentials directly,
   tokens are bearer tokens, and Bluesky documents the mechanism as legacy to be
   phased out for third-party clients.
2. **The AT Protocol OAuth profile** (atproto.com/specs/oauth): authorization
   code + PKCE, pushed authorization requests, DPoP-bound tokens, and a
   `client_id` that is the URL of a hosted client-metadata document instead of
   a pre-registered secret. The user approves the app in their server's own
   login page, so the client never sees a password.

OpenReel's architecture (AGENTS.md § Architectural Intent) makes the PDS, not
the client, the owner of identity, and the client must work with any
AT Protocol-compliant PDS, not only one OpenReel operates. The upstream PDS
pinned in `infra/pds/compose.yaml` (0.4.219) already serves the OAuth
authorization server, and in `PDS_DEV_MODE` it accepts a plain-http
`localhost` issuer and the spec's loopback development client.

Constraints specific to iOS:

- Handle resolution via DNS TXT records is not available to an app; only the
  HTTPS `/.well-known/atproto-did` method is, so a network resolver
  (`com.atproto.identity.resolveHandle`) is needed as a fallback.
- `ASWebAuthenticationSession` can return a custom-scheme redirect to the app
  but cannot return an `http://127.0.0.1` one.
- A DPoP private key must never leave the device; the Keychain's
  `ThisDeviceOnly` accessibility is the right home for it.

## Decision

The iOS client authenticates with **AT Protocol OAuth as a public native
client with DPoP-bound tokens**. Specifically:

- **Client identity.** `client_id` is
  `https://openreel.social/oauth/ios-client-metadata.json`; the document is
  committed at `apps/ios/OAuth/ios-client-metadata.json` and must be hosted
  byte-for-byte at that URL on the project domain (ADR-0001). The redirect URI
  is `social.openreel:/oauth/callback` — the client host reversed, as the
  profile requires for native custom schemes — and the app registers that URL
  scheme. `token_endpoint_auth_method` is `none`; a mobile app cannot keep a
  client secret.
- **Flow.** Identifier → DID → DID document → PDS → protected-resource
  metadata → authorization-server metadata (issuer must equal the origin it
  was fetched from) → PAR → browser → `state`, then `error`, then `iss`
  checks → code exchange → `sub` verified against the resolved DID. When the
  user types a server instead of an account, the token's `sub` is resolved
  and its PDS's authorization server must match the issuer we talked to.
- **Identity resolution.** Handles are resolved by the `/.well-known/atproto-did`
  probe, then an XRPC `resolveHandle` at a configured resolver. DIDs are
  resolved at the configured PLC directory (`did:plc`) or the DID host
  (`did:web`). The handle is verified bidirectionally; one that does not
  verify is shown as unverified rather than trusted.
- **Tokens.** Every access and refresh token is DPoP-bound to a per-session
  P-256 key generated with CryptoKit. The session (tokens, key, identity,
  server metadata) is one Keychain item with
  `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`. Refresh tokens are
  single-use, so concurrent refreshes are coalesced.
- **Lifecycle semantics.**
  - *Launch:* restore from Keychain; refresh if the access token is within 30 s
    of expiry.
  - *Expired:* `invalid_grant` on refresh, or a 401 that survives one refresh
    and retry, clears the session and returns the user to sign-in with an
    explanation.
  - *Unavailable:* a transport failure or 5xx keeps the stored session; the UI
    shows the user as signed in with a "cannot reach server" state and a
    retry. An outage is never treated as a sign-out.
  - *Sign out:* clear the Keychain first, then best-effort RFC 7009 revocation.
    A dead server must not prevent signing out.
- **Local development.** Debug builds use the profile's loopback client
  (`client_id` = `http://localhost?redirect_uri=…&scope=…`), bind a one-shot
  listener on `127.0.0.1` to catch the redirect, and dismiss the browser sheet
  programmatically. They target the Compose PDS at `http://localhost:3000`
  and the private PLC published on `127.0.0.1:2582`; `allowInsecureLocalhost`
  is the only place plain http is accepted and it is compiled out of release
  builds. This is simulator-only.
- **Code placement.** Protocol logic lives in the local Swift package
  `apps/ios/Packages/OpenReelATProto` behind an injectable HTTP transport, so
  it is unit-tested without a server and never embedded in SwiftUI views.

## Alternatives considered

| Option | Why not |
|---|---|
| `createSession` with app passwords now, OAuth later | Puts user credentials in the client, uses bearer tokens, and is the path Bluesky is deprecating for third parties; migrating later would change the stored-session shape and the sign-in UX. The server already supports OAuth, so deferring buys little. |
| Third-party Swift OAuth/atproto library | None is pinned or vetted in the repo; the atproto profile's PAR, DPoP nonce handling, and loopback mode are a small, well-specified surface, and owning it keeps the dependency count at zero and the behaviour testable. |
| Universal-link (`https://openreel.social/...`) redirect | Needs an `apple-app-site-association` file on the domain and Associated Domains entitlement before any sign-in works; the custom scheme is what the profile defines for native apps and works today. Can be added later as a second redirect URI. |
| Fixed loopback port in debug builds | Collides with anything else on the machine; the profile explicitly ignores the port for loopback clients, so an ephemeral one costs nothing. |
| Backend-mediated login (OpenReel gateway holds tokens) | Makes OpenReel's server a custodian of credentials for accounts on arbitrary PDSs, contradicting the client-as-reference-client intent, and adds infrastructure before any service needs it. |

## Consequences

- Sign-in works against any compliant PDS, including Bluesky-hosted accounts,
  with no OpenReel account system.
- The client-metadata document is a deployment dependency: it must be served
  at the `client_id` URL before a release build can sign in, and changing
  `redirect_uris`, `scope`, or `dpop_bound_access_tokens` requires updating the
  hosted copy in lock-step with the app.
- Release handle resolution currently falls back to the public Bluesky API
  (`public.api.bsky.app`) when a handle publishes no well-known file. That is
  an external dependency on the sign-in path until OpenReel's AppView exposes
  `com.atproto.identity.resolveHandle`.
- Any future OpenReel service that needs the user's identity receives a
  DPoP-bound token it cannot replay as a bearer token; service-side
  verification will have to follow the atproto service-auth pattern rather
  than copy the access token around.
- The package depends on CryptoKit and so builds on Apple platforms only; it
  cannot be compiled or tested on Linux CI without a Swift-Crypto shim.
- Reversal cost is moderate: the flow and token types are isolated in the
  package behind `ATProtoSessionManager`, so swapping mechanisms would not
  touch the views, but stored sessions would be invalidated.

## Revisit if

- The atproto OAuth profile changes `transition:generic` for granular scopes
  the client needs, or drops support for custom-scheme redirects.
- OpenReel runs its own AppView/gateway that should replace the Bluesky
  resolver fallback.
- A universal-link redirect becomes required (e.g. for passkey hand-off) and
  the domain's association file is deployable through CI.
- CI needs to build the iOS package on Linux.
