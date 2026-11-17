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
them as tabs, plus any feeds the viewer added from other generators (see
[Other people's feeds](#other-peoples-feeds)). Selecting a tab calls `getFeed`
with that feed's URI. The AppView puts its default feed (`DEFAULT_FEED_URI`)
first.

**My feeds** (the button beside the tabs) lists the tabs with each feed's
ranking family and weights. The viewer can drag to reorder them, hide feeds
they do not use, and add a feed by domain. Order, hidden feeds and added feeds
are saved on the device only (`FeedPreferences` in the app); nothing is
written to the viewer's repository.

## Configuring a feed

Feeds are declared in `services/feedgen/feeds.json`. Set
`FEEDGEN_FEEDS_FILE` to load a different file. Feedgen validates the file at
startup and refuses to start if it is invalid.

```json
{
  "id": "trending",
  "displayName": "Trending",
  "description": "Videos people watch to the end and like, favoring new ones.",
  "rankingCriteria": "heuristic",
  "ranking": {
    "type": "weighted",
    "weights": [
      { "signal": "completion", "weight": 0.4 },
      { "signal": "likeRatio", "weight": 0.3 },
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

| Signal       | Value                                                                                  |
| ------------ | -------------------------------------------------------------------------------------- |
| `views`      | The post's view count divided by the highest view count of any playable post           |
| `likes`      | The post's like count divided by the highest like count of any playable post           |
| `recency`    | `0.5 ^ (hours since posted / halfLifeHours)`                                           |
| `completion` | `(avg completion × views + k × site completion) / (views + k)`                         |
| `likeRatio`  | `(likes from sharing viewers + k × site ratio) / (sharing viewers + k)`                |

Ties go to the newer post. Weighted feeds page by offset, so a post whose rank
changes between pages can repeat or be skipped. The app drops repeats.

#### Completion and like ratio

Both are averages, and an average over a handful of views is noise: one view at
100% would otherwise beat forty views at 90%. Each is smoothed toward the site's
mean as if the post had `k = 10` extra views at that mean (`PRIOR_VIEWS` in
`services/feedgen/src/feeds.ts`). A post with no views scores the site mean; at
ten views it is half its own rate and half the site's. When nothing on the site
has views, both signals are 0 for every post.

- **`completion`** is `video_post_stats.avg_completion_rate`, the mean over the
  post's watch events of watched time over video length, capped at 1 per event.
  The site completion is the mean over every watch event.
- **`likeRatio`** counts only accounts that shared a watch of the post
  (`viewer_count`), and how many of them also like it (`viewer_like_count`). A
  rewatch does not count twice.

The like ratio deliberately leaves out likes from everyone else. Likes need no
opt-in but views do (see [Consent](#consent)), so likes over views would mix two
audiences. A post whose viewers mostly do not share watch history would score a
high ratio because of who its audience is, not how they responded. Counting
both sides within the viewers who share avoids that. The cost is that the ratio
rests on fewer accounts, and until more viewers opt in, most posts sit near the
site mean.

`social.openreel.engagement.completionRate#likeRatioBps` describes a raw
likes-to-views aggregate. Nothing serves it yet, and it is not this signal.

### Shipped feeds

| Feed     | Ranking                                                                  |
| -------- | ------------------------------------------------------------------------ |
| Latest   | Chronological, every playable video                                      |
| Popular  | Weighted, 100% likes                                                     |
| Trending | Weighted, 40% completion, 30% like ratio, 30% recency (halves every 24 h) |

Trending is the plan's heuristic feed (project plan 5.5.3). It uses only public
aggregates, so its `rankingCriteria` is `heuristic`.

A feed ranked by views (`{ "signal": "views", "weight": 1 }`) still works; it
is not shipped.

## Where views come from

1. When a viewer swipes away from a reel they watched for at least 2 seconds,
   the app writes a `social.openreel.engagement.watchEvent` record to the
   **viewer's own repository** on their PDS (`com.atproto.repo.createRecord`).
2. The AppView receives the record from Jetstream and stores it in
   `watch_event`. It then recounts the post's `video_post_stats` (`view_count`
   and `avg_completion_rate`) from scratch, so replays and deletes stay
   correct.
   It also counts the distinct accounts that shared a watch (`viewer_count`)
   and how many of them like the post (`viewer_like_count`), for the
   `likeRatio` signal.
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
   It also recounts `viewer_like_count`, the likes from accounts that shared a
   watch of the post.
3. Feedgen reads `like_count` for the `likes` signal and `viewer_like_count`
   for `likeRatio`. The AppView returns `like_count` as `likeCount` on every
   post view.

Which posts the viewer has liked comes from their own repository
(`com.atproto.repo.listRecords`), not the AppView, so the app needs no
authenticated AppView call. Until the AppView has indexed a new like, the app
adds the viewer's own change to the count it shows.

A like is an explicit, public action, so unlike watch events it needs no
opt-in. It is visible to anyone, as likes are on Bluesky.

## Other people's feeds

Anyone can run a feed generator for OpenReel on their own domain
([ADR-0010](../adr/0010-third-party-feed-generators.md)).

```text
iOS app ──describeFeedGenerator──────────────────────────────▶ feeds.example.com
iOS app ──getFeed(at://feeds.example.com/…/cats)──▶ AppView ──getFeedSkeleton──▶ feeds.example.com
                                                      │  hydrates from its own index
```

A generator serves `social.openreel.feed.describeFeedGenerator` and
`social.openreel.feed.getFeedSkeleton` over HTTPS at its domain. Its feed URIs
use that domain, or `did:web:` plus the domain, as the authority:
`at://feeds.example.com/social.openreel.feed.generator/cats`.

- **Adding one (app):** the viewer types a domain in My feeds. The app calls
  `describeFeedGenerator` on `https://<domain>` directly and keeps only feeds
  whose URI authority is that domain, so a host cannot list feeds served by
  someone else. Added feeds are saved on the device.
- **Playing one (AppView):** `RoutingSkeletonSource` sends feeds whose
  authority our feedgen publishes under to `FEEDGEN_URL`, and any other
  domain or `did:web` authority to that host. `did:plc` authorities are
  refused (`UnknownFeed`) until generator records are published.
- **Guards:** requests to other hosts go through `public-http.ts`: HTTPS on
  443 only, no IP literals or local names, every resolved address must be
  public (checked in the socket's lookup, so DNS rebinding cannot change it),
  no redirects, 5 s and 1 MB limits. Skeletons are validated against the
  Lexicon and cut to the requested `limit`.
- **What a generator controls:** only which of the AppView's indexed, playable,
  not-taken-down posts appear and in what order. Hydration and moderation are
  the same as for our feeds. Its ranking disclosure is self-declared.
- **Turning it off:** `EXTERNAL_FEEDS=off` on the AppView serves only our own
  feeds; other feed URIs return `UnknownFeed`.

## Not built yet

- Following and Social Discovery feeds: the follow graph is not indexed.
- Publishing `social.openreel.feed.generator` records. Until they exist, feedgen
  describes its own feeds and does not verify a feed URI's authority.
- Personalized or opt-in feeds (plan tier 2, "For You"). Tier 2 changes what
  data a generator sees, so it needs an ADR first.
- Resolving third-party feeds through generator records, rate limits or
  caching for external generators, and syncing My feeds across devices.
- Stable paging for weighted feeds. They page by offset over live scores, so a
  page can repeat or skip a post.
- Precomputed scores. Every request scores every playable post. At larger
  scale, feeds would score on a schedule and page over stored scores.

## Trying it locally

With the local stack running (`make up`), run `make seed-videos`, then
`make seed-likes` for Popular and `make seed-views` for Trending.
`seed-views` has demo accounts watch three of the newest videos to different
lengths, and like them at different rates. It then waits until Trending ranks
them in that order. Swipe the feed tabs, or open My feeds, to switch feeds.
