# ADR-0006: Video media pipeline and feed hydration

- **Status:** Accepted
- **Date:** 2026-10-05
- **Deciders:** ZackMurry

## Context

The iOS client needs real, playable video from the backend. Until now there
was a `social.openreel.video.post` Lexicon and a `video_post` table, but
nothing indexed posts, transcoded video, or served a feed.

The project plan (`docs/reference/project-plan.md` sections 4.3, 5.2.4, 5.4.4,
5.7) sets the direction: the source video is a blob on the author's PDS, HLS
renditions are derived from it (H.265 first, H.264 fallback, 2-6 s segments),
feed generators return post URIs, and the AppView hydrates them. The plan
assumes S3 and a CDN, but it contradicts itself on CloudFront vs Cloudflare,
and ADR-0002 leaves the CDN undecided. The dev server (ADR-0005) has neither.

## Decision

**Flow.** The client uploads the video to its PDS (`uploadBlob`) and writes a
`social.openreel.video.post`. Then:

1. The AppView follows Jetstream and indexes valid posts and their authors
   into Postgres. It saves a resume cursor and queues the video blob in
   `video_media`.
2. `services/media` claims jobs from `video_media` (`FOR UPDATE SKIP LOCKED`),
   downloads the blob from the author's PDS, checks it hashes to the CID in
   the record, runs ffmpeg, and publishes the output.
3. The feed generator's `social.openreel.feed.getFeedSkeleton` returns post URIs
   (chronological for now, only posts whose media is ready).
4. The AppView's `social.openreel.feed.getFeed` fetches the skeleton and returns
   `social.openreel.video.defs#postView`s with `playlist` and `thumbnail` URLs.

**Renditions.** HEVC 720p, H.264 720p, H.264 360p (never upscaled), in fMP4 with
4 s segments and aligned 2 s keyframes, behind one multivariant playlist, plus
a poster JPEG. Renditions are keyed by (author DID, blob CID), so they are
immutable and posts reusing a blob share them.

**Storage.** A `MediaStore` interface with a filesystem implementation. An
nginx container (`media-cdn`) serves it with immutable caching. An S3
implementation and a real CDN replace these later without changing the URL
layout or the AppView.

**Queue.** The Postgres table above. No new queue technology.

**Lexicons.** The three new documents mirror their `app.bsky.feed.*`
equivalents so existing feed-generator patterns carry over.

## Alternatives considered

| Option | Why not |
|---|---|
| S3-compatible store now (MinIO, Garage) | A new stateful service on the dev host before anything needs it; the interface keeps that door open. |
| Redis or a dedicated queue for jobs | Postgres already holds the rows; `SKIP LOCKED` is enough at this volume and keeps job state and index state in one transaction. |
| Transcode in the AppView | ADR-0002: CPU-heavy work stays out of request-serving services. |
| Reuse `app.bsky.feed.getFeedSkeleton` | `make lex-check` only allows vendored `com.atproto.*` documents; an OpenReel copy keeps the same shape. |
| Have the client upload HLS directly | Clients would control what everyone else plays, and the PDS blob would no longer be the source of truth. |

## Consequences

- Upload to playable takes seconds for short clips. Throughput is one job at a
  time per worker; add workers (or hosts) to scale, since claiming is safe
  under concurrency.
- The PDS blob limit is raised to 100 MB to match the Lexicon.
- Blobs are fetched with an SSRF-protected client, except for PDS origins the
  operator aliases (`PDS_ALIASES`). ffmpeg only accepts MP4/MOV/MKV/WebM from
  local files, so an upload cannot be a playlist that pulls in other files.
- Only `did:plc` identities are resolved; `did:web` authors are indexed
  without handles and their videos fail to transcode.
- Not done yet: removing renditions of deleted posts, HDR-to-SDR tone mapping
  (HDR sources are converted to 8-bit without it), backfilling posts older
  than Jetstream's retention, verifying handles, and ranking.

## Revisit if

Media moves to S3 and a CDN (implement `MediaStore`, point
`MEDIA_PUBLIC_URL` at the CDN), transcode volume outgrows one worker, or
OpenReel adopts a hosted video service.
