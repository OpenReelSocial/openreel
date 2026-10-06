import Foundation

/// Feed paging. `getFeed` is unauthenticated, so the AppView it reads from
/// (`Backend.current.appViewURL`) is independent of the account's PDS.
enum FeedConfiguration {
    /// Posts per `getFeed` request.
    static let pageSize = 15

    /// Request the next page when the viewer is this many reels from the end,
    /// so paging never shows a spinner at normal scroll speed.
    static let loadMoreThreshold = 5
}
