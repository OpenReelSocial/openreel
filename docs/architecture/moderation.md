# Moderation

How moderation reaches the viewer, and what each part of the system owes the
others. The design is the project plan's three layers (§5.8): a baseline
labeler every client uses, any number of optional labelers on top, and an
automated classifier that proposes labels for human review. Moderation acts on
reach, not storage: a hidden post still exists on its author's PDS.

The iOS client side is built. The backend pieces below are not yet; until they
exist the client simply sees no labels from labelers and reports fail with a
clear message.

## Client behaviour (iOS, done)

Label interpretation lives in `OpenReelATProto/Moderation/` (`ModerationPolicy`,
unit-tested); the app's UI is under `apps/ios/Sources/OpenReel/Moderation/`.

**Where labels come from**

- `postView.labels` (`social.openreel.video.defs#postView`): an array of
  `com.atproto.label.defs#label` the AppView attaches. Labels whose `uri` is the
  post or the author's DID apply. The client resolves retractions (`neg`, by
  `cts` order) and drops expired labels (`exp`), so the AppView may send raw
  label history.
- The record's own `labels` (`com.atproto.label.defs#selfLabels`): content
  warnings the author set in the composer. These already work end to end,
  because the AppView passes the record through unchanged.

**What the values do** (viewer preferences in Account → Moderation; defaults
shown)

| Value | Category | Default | Effect |
| --- | --- | --- | --- |
| `nsfw` (also `porn`, `sexual`, `nudity`) | Adult content | Blur | Cover with "Show video"; playback paused until revealed |
| `graphic-violence` (also `graphic-media`, `gore`) | Graphic violence | Blur | Same |
| `misinformation` | Misinformation | Label | Badge on the reel |
| `spam` | Spam | Label | Badge on the reel |
| `!warn` | — | Always | Generic blur, regardless of preferences |
| `!hide`, `!takedown` | — | Always | Removed from the feed; not revealable (ignored as self-labels) |
| `safe`, anything else | — | — | Nothing shown |

Each category can be set to Show, Blur/Label, or Hide. Hide filters the post out
of the feed client-side.

**What the client sends**

- Every `getFeed` carries `atproto-accept-labelers: <baseline DID>;redact` once
  the baseline labeler's DID is set (see below). Nothing is sent while it's unset.
- Reports: the reel's action fan (hold the heart) has **Report**. It calls
  `com.atproto.moderation.createReport` on the viewer's PDS with
  `atproto-proxy: <baseline DID>#atproto_labeler`, or with no proxy header when
  no labeler is configured, in which case the PDS uses its own report service.
  Subjects are `com.atproto.repo.strongRef` (a video) or
  `com.atproto.admin.defs#repoRef` (an account); reasons are the
  `com.atproto.moderation.defs#reason*` values.
- The composer has **Content warning** toggles (Adult content, Graphic
  violence) that write self-labels `nsfw` / `graphic-violence` on the post.

## Backend to do

Roughly in the order that unlocks the most:

1. ~~**Takedowns (#120).**~~ Done: `make takedown` (procedure in
   `infra/README.md`) calls `com.atproto.admin.updateSubjectStatus` on the PDS
   and the AppView. The AppView drops the account or record (videos, comments,
   likes) and won't index it again, and the media worker deletes the renditions
   and invalidates them on CloudFront. The client needs nothing extra: a post
   the AppView stops returning disappears from the feed.
2. **Reports reach someone.** Set `PDS_REPORT_SERVICE_URL` and
   `PDS_REPORT_SERVICE_DID` on the PDS to the moderation service (an Ozone
   instance is the least work). Until then, Report shows "Reporting isn't set
   up on this server yet."
3. **Baseline labeler** (`services/labeler/`, per #120's follow-up). Needs a DID
   whose document has an `#atproto_labeler` service and an `#atproto_label`
   signing key, and must serve `com.atproto.label.subscribeLabels` /
   `queryLabels`. Ozone provides all of this; it also gives a human review queue
   for the classifier (layer 3).
4. **AppView attaches labels.** Subscribe to the labelers it supports, store the
   labels, read `atproto-accept-labelers` on `getFeed`, and fill
   `postView.labels` for those labelers. For a labeler marked `;redact`, omit
   posts it labeled `!hide` or `!takedown` instead of sending them. Echoing
   self-labels into `labels` is optional; the client reads them from the record.
5. **Feed generators.** Deprioritize `spam` and, once the classifier runs,
   admit only `safe` posts to discovery feeds (safe-by-default, plan §5.8.1).
6. **Turn it on in the client.** Set `Backend.baselineLabelerDID` in
   `apps/ios/Sources/OpenReel/Backend.swift` for the deployments that have a
   labeler. That one line enables the header, report routing, and the labeler's
   name in the UI.

## Testing the client before the backend exists

- **Self-labels, on a real backend:** post a video with a content warning
  toggled on. It plays in the feed behind a blur cover.
- **A labeler of your own:** launch a Debug build from Xcode with
  `OPENREEL_LABELER_DID=did:plc:…` in the scheme's environment to send the
  header and proxy reports to that labeler.
- **Previews:** `MockReelProvider` includes a reel labeled `nsfw` and one labeled
  `misinformation` from a mock labeler.
