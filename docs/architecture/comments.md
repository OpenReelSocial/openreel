# Comments

Comments on videos, in the AT Protocol shape the rest of OpenReel uses: each
comment is a record in the commenter's own repository, and the AppView indexes
them from the firehose and serves them back. The Lexicons, the iOS client, and
the AppView are done; labels on comments wait for the labeler.

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

## AppView

- **Indexing** (`services/appview/src/indexer/`): creates, edits, and deletes of
  `social.openreel.video.comment` are validated against the Lexicon and stored
  in `video_comment` (migration `0004_comments`) only if `subject` is an indexed
  video post and any `parent` is an indexed top-level comment on that same
  video. Anything else is dropped, including a reply to a reply. An edit that
  makes an indexed comment inadmissible removes it, and a top-level comment
  edited into a reply takes its replies with it.
- **Removals** follow from foreign keys: deleting a post (or purging its
  account) drops its comments, and deleting a top-level comment drops its
  replies. A removed account's own comments are purged with its likes and
  watch events.
- **Counts:** `video_post_stats.comment_count` (top-level and replies) is
  recounted like `like_count` and hydrated as `postView.commentCount`.
  `replyCount` is counted when a page is read.
- **`social.openreel.video.getComments`** (`/appview/xrpc/` on the hosts):
  top-level comments newest first, or with `parent` that comment's replies
  oldest first, keyset-paged by `(sort_at, uri)`. `sort_at` is the earlier of
  the record's `createdAt` and when it was first indexed, as for posts. An
  unknown video or parent answers HTTP 404 `NotFound`; a bad cursor answers
  400 `InvalidRequest`.
- **Backfill:** the AppView's Jetstream cursor is keyed on the set of
  collections it subscribes to, so adding a collection replays what Jetstream
  still retains (24 hours by default). Older comments need a repository
  re-read, which is not built.

## Not done yet

- **Labels:** attach `labels` to `commentView` for the requested labelers, as
  for posts, and omit comments a `;redact` labeler hides (see `moderation.md`).
- **Takedowns** of individual comments (#120).
- **Ranking:** comment counts are an engagement signal the feed generator
  could use.

## Trying it now

Hold the heart on any reel → Comments → write one → send. The record lands in
your repo, and the sheet shows it once the AppView has indexed it, usually
within a second.
