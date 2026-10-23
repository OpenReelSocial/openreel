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
`Sources/` changes. `project.yml` defines the shared `OpenReel` scheme, so
regenerating also resets edits to it, such as an `OPENREEL_BACKEND`
environment variable.

## Layout

| Path | Contents |
| --- | --- |
| `Sources/OpenReel/` | App target: feed (`Feed/`), pooled HLS playback (`Player/`), posting videos (`Create/`), and the sign-in / account UI under `Auth/` |
| `Packages/OpenReelATProto/` | Local Swift package: identity resolution, AT Protocol OAuth (PAR, PKCE, DPoP), session persistence and refresh, record writes and blob uploads, and the AppView `getFeed` client. No UI. See ADR-0004 |
| `OAuth/ios-client-metadata.json` | The OAuth client-metadata document; must be hosted at `https://openreel.social/oauth/ios-client-metadata.json` for release builds |
| `Supporting/Info.plist` | URL schemes for the OAuth redirects (release, AWS, Hetzner dev server) and the local-networking ATS exception |

## Signing in

The app signs in with AT Protocol OAuth (ADR-0004): the user enters a handle,
DID, or server address, approves OpenReel in their server's login page, and the
app receives DPoP-bound tokens that are stored in the Keychain and refreshed on
launch. Sign-out clears the Keychain before revoking the tokens, so it works
even when the server is down.

### Debug builds

Debug builds sign in against the backend chosen in
`Sources/OpenReel/Backend.swift`. Against a deployed backend they are a native
client whose metadata that server's nginx hosts; against the local stack they
use the spec's loopback development client. Choose with `OPENREEL_BACKEND`
under Product → Scheme → Edit Scheme → Run → Arguments → Environment
Variables. The variable only applies to launches from Xcode; opened from the
home screen, the app uses the default.

- **AWS (default):** the shared dev/demo backend from ADR-0007 at
  `dev.openreel.social` — PDS, private PLC (`/plc`), AppView (`/appview`),
  and media on CloudFront (`media.dev.openreel.social`). The client metadata
  is at `https://dev.openreel.social/oauth/ios-client-metadata.json`,
  redirecting to `social.openreel.dev:/oauth/callback`. The PDS requires an
  invite and handles end in `.dev.openreel.social`; `infra/README.md` shows
  how to make an invite, and the seed script can make an account for you
  (it prints the handle and password):

  ```bash
  PUBLIC_URL=https://dev.openreel.social PDS_ADMIN_PASSWORD=... make seed-videos
  ```

  Works on a device as well as the Simulator.
- **Hetzner dev server (`OPENREEL_BACKEND=dev-server`):** the earlier shared
  server from ADR-0005 at `openreel.zackmurry.com`, superseded by ADR-0007
  and kept only until it is shut down. Same layout, media under `/media`,
  client metadata hosted there, redirect `com.zackmurry.openreel:/oauth/callback`.
- **Local stack (`OPENREEL_BACKEND=local`):** Simulator only: a device cannot
  reach your Mac's `localhost`, and plain-http servers are only accepted for
  loopback hosts.

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
pause. The feed is unauthenticated and comes from the AWS backend in Release
builds and by default in Debug builds.

The feed is empty until something is posted. `make seed-videos` posts
generated clips and waits until they are playable — against AWS with the
variables above, or against `make up` with no variables. `make e2e-upload`
posts one clip and times each stage to playback.

Playback follows the directional preloading in the project plan (§5.7.5):
`FeedPlaybackController` keeps an `AVPlayer` with an item attached for the
visible reel, the next two, and the previous one, caps preloaded items at a
few seconds of buffer, releases everything further away, and reuses released
players. Only the visible player plays. It is a pool of `AVPlayer`s rather
than one `AVQueuePlayer` because the feed scrolls in both directions and
items need to be preloaded out of order.

## Posting a video

The Create tab posts a video from the photo library to the signed-in
account. The app checks it against the `social.openreel.video.post` Lexicon
(a video type, at most 100 MB), reads its duration and aspect ratio with
AVFoundation, uploads it with `com.atproto.repo.uploadBlob`, and writes the
record with `com.atproto.repo.createRecord`. It then polls the default
(Latest) feed until the AppView serves the post, which happens once the media
pipeline has transcoded it to HLS: about 20 s for a short clip on the AWS
backend. **Watch in Latest** opens the feed at the new post.

In the Simulator, drag a video file onto the Simulator window (or run
`xcrun simctl addmedia booted clip.mp4`) to add it to Photos.

## Tests

The package tests run without a server or Xcode project:

```bash
cd apps/ios/Packages/OpenReelATProto
swift test
```

They cover identifier syntax, DID-document parsing, handle/DID resolution,
PKCE and DPoP proof construction, authorization-server metadata validation,
the session manager's sign-in, restore, refresh, expiry, outage, and
sign-out paths, record writes, video upload and `video.post` record building
with the Lexicon's limits, and `getFeed` request building and response decoding, against
a stubbed HTTP transport. Feed UI and playback have no automated tests yet.
