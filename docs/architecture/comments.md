# Comments

Comments on videos, in the AT Protocol shape the rest of OpenReel uses: each
comment is a record in the commenter's own repository, and the AppView indexes
them from the firehose and serves them back. The iOS client and the Lexicons
are done; the AppView side is not yet.

## Data model (Lexicons, done)

- **`social.openreel.video.comment`** (record, key `tid`): `subject` (strongRef
  to the video post), optional `parent` (strongRef to a top-level comment on the
  same video), `text` (1–300 graphemes, at most 3000 bytes), `createdAt`.
  Deleting the record deletes the comment.
- **Threads are one level deep**, as in other short-video apps. A reply's
  `parent` is always a top-level comment. Replying to a reply points at that
  same top-level comment, and the client starts the text with the handle being
  answered.
- **`social.openreel.video.getComments`** (query): `uri` (the video, required),
  optional `parent` (a top-level comment: return its replies instead),
  `limit` (1–100, default 30), and `cursor`. Returns
  `{ comments: commentView[], cursor? }`. Error `NotFound` when the video isn't
  indexed or was removed.
- **`social.openreel.video.defs#commentView`**: `uri`, `cid`, `author`
  (authorView), `record` (the stored record), optional `replyCount` (top-level
  only), `indexedAt`, optional `labels`.
- **`postView.commentCount`** (optional): top-level comments and replies
  together.

## Client behaviour (iOS, done)

- Hold the heart and choose **Comments** (formerly Reply). This opens a sheet
  over the reel, which keeps playing.
- The sheet shows top-level comments, paged by cursor as you scroll, and loads
  replies on demand ("View N replies"). The count in the header is
  `postView.commentCount` plus your changes this session.
- **Posting** writes the record to your PDS via
  `com.atproto.repo.createRecord`. The new comment appears at once marked
  "Posting…", and stays on screen until the AppView returns it, so indexing lag
  doesn't make it vanish. A failure shows Retry or Delete.
- **Deleting your own** (long-press → Delete) calls
  `com.atproto.repo.deleteRecord`.
- **Moderation:** `commentView.labels` goes through the same `ModerationPolicy`
  as videos (see `moderation.md`). Hidden comments are left out, blurred ones
  collapse to "Comment hidden: … Show", and other labels show as badges.
  Long-press → **Report** sends `createReport` for the comment (strongRef) or
  its author.
- `getComments` carries `atproto-accept-labelers` like `getFeed`.
- **No endpoint yet:** a 404 that isn't the Lexicon's `NotFound`, or a 501,
  makes the sheet say comments aren't available on this server yet. Posting
  still works and writes the record, so comments made now will appear once the
  AppView indexes them (given a backfill; see below).

## Backend to do (AppView)

1. **Index comments.** Handle `social.openreel.video.comment` creates and
   deletes in the indexer, next to likes (`services/appview/src/indexer/`).
   Validate the record against the Lexicon. Store it only if `subject` is an
   indexed video post and any `parent` is an indexed top-level comment on that
   same video; otherwise drop it. Suggested table: `video_comment(uri, cid,
   author_did, subject_uri, parent_uri, text, record, created_at, indexed_at)`.
2. **Counts.** Keep `comment_count` on the post's stats row and `reply_count`
   per top-level comment. Hydrate `postView.commentCount`.
3. **`getComments` endpoint** under `/appview/xrpc/`. Top-level comments
   newest first, replies oldest first, cursor-paged. Hydrate the author handle
   as `getFeed` does. Return `NotFound` for an unknown video.
4. **Removals.** When a post is deleted or taken down, drop its comments. When
   an account is removed (`#accountChanged` in `indexer.ts`, which already purges
   posts and likes), purge its comments and fix the counts. Taken-down comments
   (#120) must stop being served.
5. **Labels** (once the labeler exists): attach `labels` to `commentView` for
   the requested labelers, as for posts. Omit comments a `;redact` labeler hides.
6. **Backfill (optional).** Comments written before the indexer handles them
   are already in users' repositories. Re-reading repos, or replaying the
   firehose from a cursor, picks them up.
7. **Ranking (optional).** Comment counts are an engagement signal the feed
   generator can use.

## Trying it now

Hold the heart on any reel → Comments → write one → send. The record lands in
your repo; check with
`com.atproto.repo.listRecords?repo=<your DID>&collection=social.openreel.video.comment`
on your PDS. Until the AppView endpoint exists, the sheet shows the "not
available yet" state with your comment from this session on top.
