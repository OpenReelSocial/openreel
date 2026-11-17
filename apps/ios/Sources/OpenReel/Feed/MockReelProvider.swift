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
            uri: "at://openreel.social/social.openreel.feed.generator/popular",
            displayName: "Popular",
            description: "The most-liked videos first. A like is a record the viewer published from their own account; newer videos win ties.",
            rankingCriteria: "heuristic",
            weights: [RankingWeight(signal: "likes", weightBps: 10_000)]
        ),
    ]

    /// Feeds a third-party generator at `feeds.example.com` might serve.
    static let externalFeeds = [
        FeedGeneratorView(
            uri: "at://feeds.example.com/social.openreel.feed.generator/slow-tv",
            displayName: "Slow TV",
            description: "Long, calm videos people watch to the end.",
            rankingCriteria: "heuristic",
            weights: [
                RankingWeight(signal: "completion", weightBps: 8_000),
                RankingWeight(signal: "recency", weightBps: 2_000, halfLifeHours: 72),
            ]
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
            caption: "Mock reel #2 — placeholder HLS stream, labeled adult content by a labeler.",
            playlist: "https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_4x3/bipbop_4x3_variant.m3u8",
            labels: ["nsfw"]
        ),
        post(
            rkey: "3",
            handle: nil,
            caption: "Mock reel #3 — same source as #1, author without a handle, labeled misinformation.",
            playlist: "https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_16x9/bipbop_16x9_variant.m3u8",
            labels: ["misinformation"]
        ),
    ])

    private static func post(rkey: String, handle: String?, caption: String, playlist: String,
                             labels: [String] = []) -> VideoPostView {
        let uri = "at://did:plc:mock/social.openreel.video.post/\(rkey)"
        return VideoPostView(
            uri: uri,
            cid: "bafyreimock\(rkey)",
            author: VideoAuthorView(did: "did:plc:mock", handle: handle),
            record: VideoPostRecord(caption: caption, tags: ["preview"]),
            playlist: URL(string: playlist)!,
            indexedAt: "2026-10-05T00:00:00.000Z",
            labels: labels.map {
                ATLabel(src: "did:plc:mocklabeler", uri: uri, val: $0, cts: "2026-10-05T00:00:00.000Z")
            }
        )
    }
}
