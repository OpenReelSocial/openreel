import Foundation
import OpenReelATProto

/// Canned feed page for SwiftUI previews, which cannot reach the AppView.
/// Streams are Apple's public HLS example assets, not OpenReel content.
enum MockReelProvider {
    /// The feeds the default `services/feedgen/feeds.json` serves.
    static let feeds = [
        FeedGeneratorView(
            uri: "at://openreel.social/social.openreel.feed.generator/recent",
            displayName: "Latest",
            description: "Every video on OpenReel, newest first. Nothing is ranked or filtered by engagement.",
            rankingCriteria: "chronological"
        ),
        FeedGeneratorView(
            uri: "at://openreel.social/social.openreel.feed.generator/most-viewed",
            displayName: "Most viewed",
            description: "Videos with the most views first. A view is a watch event a viewer chose to publish from their own account.",
            rankingCriteria: "heuristic",
            weights: [RankingWeight(signal: "views", weightBps: 10_000)]
        ),
    ]

    static let page = VideoFeedPage(feed: [
        post(
            rkey: "1",
            handle: "sample.bsky.social",
            caption: "Mock reel #1 — placeholder HLS stream.",
            playlist: "https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_16x9/bipbop_16x9_variant.m3u8"
        ),
        post(
            rkey: "2",
            handle: "another.bsky.social",
            caption: "Mock reel #2 — placeholder HLS stream.",
            playlist: "https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_4x3/bipbop_4x3_variant.m3u8"
        ),
        post(
            rkey: "3",
            handle: nil,
            caption: "Mock reel #3 — same source as #1, author without a handle.",
            playlist: "https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_16x9/bipbop_16x9_variant.m3u8"
        ),
    ])

    private static func post(rkey: String, handle: String?, caption: String, playlist: String) -> VideoPostView {
        VideoPostView(
            uri: "at://did:plc:mock/social.openreel.video.post/\(rkey)",
            cid: "bafyreimock\(rkey)",
            author: VideoAuthorView(did: "did:plc:mock", handle: handle),
            record: VideoPostRecord(caption: caption, tags: ["preview"]),
            playlist: URL(string: playlist)!,
            indexedAt: "2026-10-05T00:00:00.000Z"
        )
    }
}
