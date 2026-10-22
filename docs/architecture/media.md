# Video media

How an uploaded video becomes something the iOS feed can play. Decisions and
alternatives are in ADR-0006.

```
iOS ──uploadBlob + createRecord──▶ PDS ──firehose──▶ Jetstream
                                                      │
                                     AppView indexer ◀┘ writes video_post, actor,
                                                        queues video_media
media worker ── claims video_media ── getBlob from PDS ── ffmpeg ── MediaStore
                                                                      │
iOS ──getFeed──▶ AppView ──getFeedSkeleton──▶ feedgen                 │
iOS ◀── postView { playlist, thumbnail } ──┘                          │
iOS ──HLS──▶ media-cdn (nginx) ◀──────────────────────────────────────┘
```

## Endpoints

| Service | Endpoint | Notes |
|---|---|---|
| AppView | `GET /xrpc/social.openreel.feed.getFeed?limit&cursor&feed` | Hydrated, playable posts. `feed` defaults to the chronological feed |
| feedgen | `GET /xrpc/social.openreel.feed.getFeedSkeleton?feed&limit&cursor` | Post URIs only |
| media | `GET /status` | Job counts by status |
| media-cdn | `/<did>/<cid>/playlist.m3u8`, `/<did>/<cid>/poster.jpg` | Static files |

On the dev server the AppView is at `https://openreel.zackmurry.com/appview/`
and media at `https://openreel.zackmurry.com/media/`. Locally they are
`http://localhost:3001` and `http://localhost:3006`.

## Media layout

```
<did>/<blob cid>/
  playlist.m3u8          multivariant playlist
  poster.jpg
  avc_720/index.m3u8     init_0.mp4, seg_000.m4s, ...
  avc_360/index.m3u8
```

Renditions above the source resolution are skipped. Segments are 4 s fMP4.

## Storage

The worker builds renditions in a scratch directory, then hands it to a
`MediaStore` chosen by `MEDIA_STORE`:

| `MEDIA_STORE` | Where renditions go | Served by | Used by |
|---|---|---|---|
| `fs` (default) | `MEDIA_ROOT/<did>/<cid>/` (default `/media`), swapped in with a rename | nginx `media-cdn` | Local Compose |
| `s3` | `s3://$MEDIA_S3_BUCKET/<did>/<cid>/` | CloudFront at `media.dev.openreel.social` | AWS dev host (ADR-0007) |

The S3 store uses the AWS SDK's default region and credential chain
(`AWS_REGION`, the EC2 instance role). Keys use the raw DID (`did:plc:...`):
the AppView percent-encodes the DID in playlist URLs and S3 decodes the path
before lookup. Every object gets `Cache-Control: public, max-age=31536000,
immutable` and a content type from its extension (an unknown extension fails
the job). The top-level `playlist.m3u8` is uploaded last, so a reader never
finds a playlist whose segments are missing. Re-publishing a key overwrites
objects in place; files from an older rendition set that the new one lacks
are left behind, unreferenced.

| Variable | Default | Notes |
|---|---|---|
| `MEDIA_STORE` | `fs` | `fs` or `s3` |
| `MEDIA_ROOT` | `/media` | `fs` only |
| `MEDIA_S3_BUCKET` | — | Required when `MEDIA_STORE=s3` |
| `MEDIA_PUBLIC_URL` | — | AppView setting: base URL clients stream from, e.g. `https://media.dev.openreel.social` |

## Job states

`video_media.status` goes `pending` → `processing` → `ready`, or → `failed`.
Failed jobs are retried with a one-minute-per-attempt backoff, up to
`MEDIA_MAX_ATTEMPTS` (3). A job left in `processing` for 15 minutes (a crashed
worker) is reclaimed. `last_error` holds the most recent failure.

## Trying it

```sh
make up
make seed-videos        # generated clips; VIDEO_DIR=... for real ones
curl -s localhost:3001/xrpc/social.openreel.feed.getFeed | jq '.feed[].playlist'
```
