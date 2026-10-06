import Foundation
import OpenReelATProto

/// What one feed cell shows, derived from an AppView post view.
struct Reel: Identifiable, Hashable {
    /// The post's AT-URI.
    let id: String
    let authorHandle: String
    let caption: String
    let tags: [String]
    /// HLS multivariant playlist.
    let videoURL: URL
    let posterURL: URL?
    /// Width over height, when the AppView knows it.
    let aspectRatio: Double?
    let accessibilityLabel: String?
    /// Moderation labels to show on the reel. The AppView does not return
    /// labels yet, so this is always empty for real posts.
    var labels: [ContentLabel] = []

    init(post: VideoPostView) {
        id = post.uri
        // The AppView reports the handle the DID document claims; fall back to
        // the DID for accounts without one.
        authorHandle = post.author.handle.map { "@\($0)" } ?? post.author.did
        caption = post.record?.caption ?? ""
        tags = post.record?.tags ?? []
        videoURL = post.playlist
        posterURL = post.thumbnail
        aspectRatio = post.aspectRatio?.value
        accessibilityLabel = post.record?.alt
    }

    /// Portrait clips fill the screen; landscape and square ones are
    /// letterboxed rather than cropped to a sliver.
    var fillsScreen: Bool {
        guard let aspectRatio else { return true }
        return aspectRatio < 0.8
    }
}

/// A moderation label shown on a reel, and the labeler that applied it.
struct ContentLabel: Hashable {
    let name: String
    let labeler: String
}
