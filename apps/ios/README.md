# OpenReel iOS

Native SwiftUI client. The Xcode project is generated, not committed — see
`.gitignore` and `AGENTS.md` § iOS Conventions.

## Setup

Requires [XcodeGen](https://github.com/yonaskolb/XcodeGen) (`brew install xcodegen`).

```bash
cd apps/ios
xcodegen generate
open OpenReel.xcodeproj
```

Run from Xcode (`Cmd+R`) with an iOS Simulator destination selected.

Regenerate the project any time `project.yml` or the file layout under
`Sources/` changes.

## Layout

| Path | Contents |
| --- | --- |
| `Sources/OpenReel/` | App target: feed (`Feed/`), pooled HLS playback (`Player/`), and the sign-in / account UI under `Auth/` |
| `Packages/OpenReelATProto/` | Local Swift package: identity resolution, AT Protocol OAuth (PAR, PKCE, DPoP), session persistence and refresh, and the AppView `getFeed` client. No UI. See ADR-0004 |
| `OAuth/ios-client-metadata.json` | The OAuth client-metadata document; must be hosted at `https://openreel.social/oauth/ios-client-metadata.json` for release builds |
| `Supporting/Info.plist` | URL scheme for the OAuth redirect and the local-networking ATS exception |

## Signing in

The app signs in with AT Protocol OAuth (ADR-0004): the user enters a handle,
DID, or server address, approves OpenReel in their server's login page, and the
app receives DPoP-bound tokens that are stored in the Keychain and refreshed on
launch. Sign-out clears the Keychain before revoking the tokens, so it works
even when the server is down.

### Debug builds

Debug builds sign in against the backend chosen in
`Sources/OpenReel/Backend.swift`. Against the dev server they are a native
client whose metadata the dev server's nginx hosts at
`https://openreel.zackmurry.com/oauth/ios-client-metadata.json`, redirecting to
`com.zackmurry.openreel:/oauth/callback`. Against the local stack they use the
spec's loopback development client.

- **Dev server (default):** the shared server from ADR-0005 at
  `openreel.zackmurry.com` — PDS, private PLC (`/plc`), AppView
  (`/appview`), and media (`/media`). Its PDS requires an invite code, so
  create the account with the PDS admin password. The simplest way is to let
  the seed script make one; it prints the handle and password:

  ```bash
  PDS_URL=https://openreel.zackmurry.com \
  APPVIEW_URL=https://openreel.zackmurry.com/appview \
  HANDLE_DOMAIN=.openreel.zackmurry.com PDS_ADMIN_PASSWORD=... make seed-videos
  ```

  Works on a device as well as the Simulator.
- **Local stack:** set `OPENREEL_BACKEND=local` under Product → Scheme → Edit
  Scheme → Run → Arguments → Environment Variables. Simulator only: a device
  cannot reach your Mac's `localhost`, and plain-http servers are only
  accepted for loopback hosts.

For the local stack:

```bash
make up                      # PDS on localhost:3000, private PLC on 127.0.0.1:2582
```

Create an account with a password you know (the demo script generates a random
one it does not print):

```bash
curl -s http://localhost:3000/xrpc/com.atproto.server.createAccount \
  -H 'content-type: application/json' \
  -d '{"handle":"alice.pds.example.com","email":"alice@example.com","password":"alice-dev-password"}'
```

Then run the app, enter `alice.pds.example.com` (or `localhost:3000` to pick
the account on the server's page), and sign in with that password in the
browser sheet. The redirect lands on a one-shot listener inside the app, which
dismisses the sheet.

### Release builds

Release builds use `client_id`
`https://openreel.social/oauth/ios-client-metadata.json` and the redirect
`social.openreel:/oauth/callback`. Sign-in fails with
`invalid_client_metadata` until `OAuth/ios-client-metadata.json` is served at
that URL. Keep the hosted copy identical to the committed file.

## Watching the feed

After sign-in the app shows `social.openreel.feed.getFeed` from the backend's
AppView (ADR-0006, `docs/architecture/media.md`): a page-snapped vertical feed
of HLS videos, paged by cursor as you scroll, with pull-to-refresh and tap to
pause. The feed is unauthenticated and comes from the dev server in Release
builds and by default in Debug builds.

The feed is empty until something is posted. `make seed-videos` posts
generated clips and waits until they are playable — against the dev server
with the variables above, or against `make up` with no variables.

Playback follows the directional preloading in the project plan (§5.7.5):
`FeedPlaybackController` keeps an `AVPlayer` with an item attached for the
visible reel, the next two, and the previous one, caps preloaded items at a
few seconds of buffer, releases everything further away, and reuses released
players. Only the visible player plays. It is a pool of `AVPlayer`s rather
than one `AVQueuePlayer` because the feed scrolls in both directions and
items need to be preloaded out of order.

## Tests

The package tests run without a server or Xcode project:

```bash
cd apps/ios/Packages/OpenReelATProto
swift test
```

They cover identifier syntax, DID-document parsing, handle/DID resolution,
PKCE and DPoP proof construction, authorization-server metadata validation,
the session manager's sign-in, restore, refresh, expiry, outage, and
sign-out paths, and `getFeed` request building and response decoding, against
a stubbed HTTP transport. Feed UI and playback have no automated tests yet.
