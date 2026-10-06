import Foundation
import Observation
import OpenReelATProto

/// The feed's contents: the first page, pull-to-refresh, and cursor paging as
/// the viewer nears the end. Playback is separate (`FeedPlaybackController`).
@MainActor
@Observable
final class FeedStore {
    enum Phase: Equatable {
        case idle
        case loading
        case loaded
        /// The first page failed; nothing to show.
        case failed(String)
    }

    typealias PageLoader = @Sendable (_ cursor: String?) async throws -> VideoFeedPage

    private(set) var phase: Phase = .idle
    private(set) var reels: [Reel] = []
    /// Set when refreshing or paging fails while reels are already on screen.
    private(set) var pagingError: String?

    @ObservationIgnored private var cursor: String?
    @ObservationIgnored private var isLoadingMore = false
    /// Bumped by every refresh so a page requested before it is discarded.
    @ObservationIgnored private var generation = 0

    @ObservationIgnored private let loadPage: PageLoader

    init(loadPage: @escaping PageLoader) {
        self.loadPage = loadPage
    }

    convenience init(client: AppViewClient) {
        self.init { cursor in
            try await client.getFeed(limit: FeedConfiguration.pageSize, cursor: cursor)
        }
    }

    func loadIfNeeded() async {
        guard phase == .idle else { return }
        await refresh()
    }

    /// Replaces the feed with its first page. On failure the current reels
    /// stay on screen.
    func refresh() async {
        generation += 1
        let current = generation
        if reels.isEmpty { phase = .loading }
        do {
            let (posts, next) = try await fetch(after: nil)
            guard current == generation else { return }
            reels = Self.unique(posts.map(Reel.init(post:)), excluding: [])
            cursor = next
            pagingError = nil
            phase = .loaded
        } catch {
            guard current == generation else { return }
            let message = UserFacingError.message(for: error)
            if reels.isEmpty {
                phase = .failed(message)
            } else {
                pagingError = message
            }
        }
    }

    /// Fetches the next page once `index` is close enough to the end.
    func loadMoreIfNeeded(currentIndex index: Int) async {
        guard phase == .loaded, !isLoadingMore, let cursor,
              index >= reels.count - FeedConfiguration.loadMoreThreshold
        else { return }

        isLoadingMore = true
        defer { isLoadingMore = false }
        let current = generation
        do {
            let (posts, next) = try await fetch(after: cursor)
            guard current == generation else { return }
            reels += Self.unique(posts.map(Reel.init(post:)), excluding: Set(reels.map(\.id)))
            self.cursor = next
            pagingError = nil
        } catch {
            guard current == generation else { return }
            // Keep the cursor; the next scroll retries.
            pagingError = UserFacingError.message(for: error)
        }
    }

    /// The AppView drops posts it cannot play yet, so a page can come back
    /// empty with a cursor. Follow a few of those before showing nothing.
    private func fetch(after cursor: String?) async throws -> ([VideoPostView], String?) {
        var cursor = cursor
        var posts: [VideoPostView] = []
        for _ in 0..<3 {
            let page = try await loadPage(cursor)
            posts += page.feed
            cursor = page.cursor
            if !posts.isEmpty || cursor == nil { break }
        }
        return (posts, cursor)
    }

    /// `ForEach` and the scroll position need unique IDs; a post can reappear
    /// across pages if the feed changed between requests.
    private static func unique(_ reels: [Reel], excluding seen: Set<String>) -> [Reel] {
        var seen = seen
        return reels.filter { seen.insert($0.id).inserted }
    }
}
