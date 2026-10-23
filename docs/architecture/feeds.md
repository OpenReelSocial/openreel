# Feeds and ranking

How OpenReel decides what a feed shows, how a new feed is configured, and
where view and like counts come from. Project plan sections 4.2 and 5.5
(`docs/reference/project-plan.md`) are the background; this document describes
what is built.

## Request flow

```text
iOS app ──getSuggestedFeeds──▶ AppView ──describeFeedGenerator──▶ feedgen
iOS app ──getFeed(feed)──────▶ AppView ──getFeedSkeleton(feed)───▶ feedgen ──▶ Postgres
                                  │  hydrates the URIs into playable post views
```

The app lists feeds from `social.openreel.feed.getSuggestedFeeds` and shows
them as tabs. The feed picker (the button beside the tabs) shows each feed's
description, ranking family, and weights. Selecting one calls `getFeed` with
that feed's URI. The AppView puts its default feed (`DEFAULT_FEED_URI`) first.

## Configuring a feed

Feeds are declared in `services/feedgen/feeds.json`. Set
`FEEDGEN_FEEDS_FILE` to load a different file. Feedgen validates the file at
startup and refuses to start if it is invalid.

```json
{
  "id": "trending",
  "displayName": "Trending",
  "description": "Popular videos, favoring recent ones.",
  "rankingCriteria": "heuristic",
  "ranking": {
    "type": "weighted",
    "weights": [
      { "signal": "views", "weight": 0.7 },
      { "signal": "recency", "weight": 0.3, "halfLifeHours": 24 }
    ]
  }
}
```

- `id` becomes the feed URI's record key:
  `at://<FEEDGEN_PUBLISHER>/social.openreel.feed.generator/<id>`. The
  publisher defaults to `openreel.social`, which matches the AppView's
  default feed URI.
- `rankingCriteria` is the family the generator discloses (see
  `social.openreel.feed.generator`). The app shows it as is, so keep it
  accurate.
- `ranking` is either `{ "type": "chronological" }` (newest first) or
  `weighted`. A weighted feed's weights must sum to 1.

Adding a feed is a config edit and a feedgen restart. It needs no code change
and no app release.

### Signals

Each signal is normalized to 0-1 before it is weighted:

| Signal    | Value                                                                     |
| --------- | ------------------------------------------------------------------------- |
| `views`   | The post's view count divided by the highest view count of any playable post |
| `likes`   | The post's like count divided by the highest like count of any playable post |
| `recency` | `0.5 ^ (hours since posted / halfLifeHours)`                              |

Ties go to the newer post. Weighted feeds page by offset, so a post whose rank
changes between pages can repeat or be skipped. The app drops repeats.

The plan's Trending formula (`0.4 completion + 0.3 like ratio + 0.3 recency`)
is not available yet. Likes are a raw count rather than a ratio to views, and
completion rate is stored (`video_post_stats.avg_completion_rate`) but is not
a signal yet.

### Shipped feeds

| Feed    | Ranking                             |
| ------- | ----------------------------------- |
| Latest  | Chronological, every playable video |
| Popular | Weighted, 100% likes                |

A feed ranked by views (`{ "signal": "views", "weight": 1 }`) still works; it
is not shipped because the demo offers two feeds.

## Where views come from

1. When a viewer swipes away from a reel they watched for at least 2 seconds,
   the app writes a `social.openreel.engagement.watchEvent` record to the
   **viewer's own repository** on their PDS (`com.atproto.repo.createRecord`).
2. The AppView receives the record from Jetstream and stores it in
   `watch_event`. It then recounts the post's `video_post_stats` (`view_count`
   and `avg_completion_rate`) from scratch, so replays and deletes stay
   correct.
3. Feedgen reads `video_post_stats` when it ranks.

The watched time comes from playback position and loop count, not wall-clock
time, so buffering and pauses do not count as watching.

### Consent

Repositories are public, so writing a watch event publishes it (see
"Private engagement data" in `packages/lexicons/AGENTS.md`). The app writes
watch events only for a signed-in viewer who has turned on **Profile >
Engagement > Share Watch History**. It is off by default. A signed-out viewer,
or one who has not opted in, adds no views.

## Where likes come from

1. Tapping the heart on a reel writes a `social.openreel.engagement.like`
   record to the **viewer's own repository**
   (`com.atproto.repo.createRecord`). Tapping again deletes it
   (`com.atproto.repo.deleteRecord`). The heart updates at once and rolls back
   if the write fails.
2. The AppView receives the record from Jetstream and stores it in
   `video_like`, then recounts `video_post_stats.like_count` as the number of
   **distinct** accounts that like the post, so a second like from the same
   account does not count twice.
3. Feedgen reads `like_count` for the `likes` signal, and the AppView returns
   it as `likeCount` on every post view.

Which posts the viewer has liked comes from their own repository
(`com.atproto.repo.listRecords`), not the AppView, so the app needs no
authenticated AppView call. Until the AppView has indexed a new like, the app
adds the viewer's own change to the count it shows.

A like is an explicit, public action, so unlike watch events it needs no
opt-in. It is visible to anyone, as likes are on Bluesky.

## Not built yet

- Following and Social Discovery feeds: the follow graph is not indexed.
- Publishing `social.openreel.feed.generator` records. Until they exist, feedgen
  describes its own feeds and does not verify a feed URI's authority.
- Completion, and likes as a ratio to views, as ranking signals.
- Personalized or opt-in feeds (plan tier 2) and third-party generators.
