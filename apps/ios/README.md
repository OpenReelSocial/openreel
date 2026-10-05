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
| `Sources/OpenReel/` | App target: feed, player, and the sign-in / account UI under `Auth/` |
| `Packages/OpenReelATProto/` | Local Swift package: identity resolution, AT Protocol OAuth (PAR, PKCE, DPoP), session persistence and refresh. No UI. See ADR-0004 |
| `OAuth/ios-client-metadata.json` | The OAuth client-metadata document; must be hosted at `https://openreel.social/oauth/ios-client-metadata.json` for release builds |
| `Supporting/Info.plist` | URL scheme for the OAuth redirect and the local-networking ATS exception |

## Signing in

The app signs in with AT Protocol OAuth (ADR-0004): the user enters a handle,
DID, or server address, approves OpenReel in their server's login page, and the
app receives DPoP-bound tokens that are stored in the Keychain and refreshed on
launch. Sign-out clears the Keychain before revoking the tokens, so it works
even when the server is down.

### Against the local PDS (Debug builds, Simulator only)

Debug builds use the spec's loopback development client and point at the
Compose stack from the repository root:

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

This only works in the Simulator: a physical device cannot reach your Mac's
`localhost`, and plain-http servers are only accepted for loopback hosts.

### Release builds

Release builds use `client_id`
`https://openreel.social/oauth/ios-client-metadata.json` and the redirect
`social.openreel:/oauth/callback`. Sign-in fails with
`invalid_client_metadata` until `OAuth/ios-client-metadata.json` is served at
that URL. Keep the hosted copy identical to the committed file.

## Tests

The package tests run without a server or Xcode project:

```bash
cd apps/ios/Packages/OpenReelATProto
swift test
```

They cover identifier syntax, DID-document parsing, handle/DID resolution,
PKCE and DPoP proof construction, authorization-server metadata validation,
and the session manager's sign-in, restore, refresh, expiry, outage, and
sign-out paths against a stubbed HTTP transport.
