import Foundation

/// Local placeholder data so the feed is demoable before the AppView exists.
/// Streams are Apple's public HLS example assets, not OpenReel content.
enum MockReelProvider {
    static let reels: [Reel] = [
        Reel(
            id: "1",
            authorHandle: "@sample.bsky.social",
            caption: "Mock reel #1 — placeholder HLS stream.",
            videoURL: URL(string: "https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_16x9/bipbop_16x9_variant.m3u8")!
        ),
        Reel(
            id: "2",
            authorHandle: "@another.bsky.social",
            caption: "Mock reel #2 — placeholder HLS stream.",
            videoURL: URL(string: "https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_4x3/bipbop_4x3_variant.m3u8")!
        ),
        Reel(
            id: "3",
            authorHandle: "@sample.bsky.social",
            caption: "Mock reel #3 — same source as #1, different caption.",
            videoURL: URL(string: "https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_16x9/bipbop_16x9_variant.m3u8")!
        ),
    ]
}
