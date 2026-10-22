# OpenReel
Open-source short-form video on the AT Protocol. Own your account, pick your algorithm.

## Local development

Prerequisites: Node 22 (see `.nvmrc`), Corepack (ships with Node), Docker with
Compose. `make check-tools` verifies them and says how to fix what is missing.

```sh
make bootstrap   # check tools, install dependencies, create .env files
make up          # build and start the full app, data, PDS, and event stack
make status      # service status; also served at http://localhost:3003
make demo-pds-event # write a sample profile to the PDS and observe the backend event
make seed-videos # post generated demo clips and wait until they play in the feed
make smoke       # black-box check: health, feed, and playback of the first post
make e2e-upload  # post one clip and time upload -> in feed -> playable
make check       # pre-PR gate: format, lint, typecheck, test
make down        # stop everything, keep volumes
```

`make up` also generates local PDS secrets into the git-ignored
`infra/pds/.env`. If a local Postgres or Redis already owns port 5432 or 6379,
change `POSTGRES_PORT` or `REDIS_PORT` in `.env` before `make up`. Run `make`
alone to list every target, and see
[docs/architecture/repository-structure.md](docs/architecture/repository-structure.md)
for the layout and command conventions. Agent and contributor rules live in
[AGENTS.md](AGENTS.md).

The full stack also runs a private development PLC directory, pinned upstream
Jetstream, and the OpenReel event consumer. `make demo-pds-event` creates a
disposable local account, writes its `app.bsky.actor.profile` record to the PDS,
then waits until the same record appears at the consumer's loopback-only API on
port 3004. No local identity is published to the public PLC directory.

## Checking a deployment

`make smoke` and `make e2e-upload` test a running stack from outside, the way a
client sees it. Both default to the local stack:

```sh
make up && make seed-videos && make smoke
make e2e-upload
```

Point them at a deployed host with `PUBLIC_URL` (the PDS origin). The AppView
and PLC then default to `$PUBLIC_URL/appview` and `$PUBLIC_URL/plc`; override
with `APPVIEW_URL` and `PLC_URL`. Media URLs are taken from the feed, so a CDN
host is followed as-is.

```sh
PUBLIC_URL=https://dev.openreel.social make smoke
PUBLIC_URL=https://dev.openreel.social EXPECT_SHA=$(git rev-parse HEAD) make smoke
PUBLIC_URL=https://dev.openreel.social PDS_ADMIN_PASSWORD=... make e2e-upload
```

`make smoke` checks PDS health and `describeServer`, PLC health, AppView health
(and, with `EXPECT_SHA`, that it runs that commit), that `getFeed` has a post,
and that the first post's playlist, a variant playlist, a media segment, and
the thumbnail all return 200. It prints one pass/fail line per check with its
timing, plus `cache-control` and any CloudFront `x-cache`, and exits non-zero
on any failure. `ALLOW_EMPTY_FEED=1` turns an empty feed into a warning, for a
freshly created environment.

`make e2e-upload` is the demo's upload-to-playback path: it creates an account
(an invite via `PDS_ADMIN_PASSWORD` if the PDS needs one, or signs in as
`SEED_HANDLE`/`SEED_PASSWORD`), posts a generated 3-second clip (or
`VIDEO_FILE`), waits for it in `getFeed`, fetches its playlist and a segment,
and prints how long each stage took. It fails after `E2E_TIMEOUT_SECONDS`
(default 300). Both need Node 22; `e2e-upload` also needs ffmpeg.
