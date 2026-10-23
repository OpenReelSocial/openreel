import Foundation
import Observation
import OpenReelATProto

/// The feed's contents: which feeds the AppView offers and which is selected,
/// the selected feed's first page, pull-to-refresh, and cursor paging as the
/// viewer nears the end. Playback is separate (`FeedPlaybackController`).
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

    /// `feed` is a generator URI; `nil` is the AppView's default feed.
    typealias PageLoader = @Sendable (_ feed: String?, _ cursor: String?) async throws -> VideoFeedPage
    typealias FeedsLoader = @Sendable () async throws -> [FeedGeneratorView]

    private(set) var phase: Phase = .idle
    /// Feeds to offer as tabs, default first. Empty until listed, or if the
    /// AppView could not list them; the default feed still plays.
    private(set) var feeds: [FeedGeneratorView] = []
    /// URI of the feed being shown; `nil` means the AppView's default.
    private(set) var selectedFeedURI: String?
    private(set) var reels: [Reel] = []
    /// Set when refreshing or paging fails while reels are already on screen.
    private(set) var pagingError: String?
    /// A reel the view should scroll to, such as a video the viewer just
    /// posted; cleared with `didReveal()`.
    private(set) var revealedReelID: String?

    @ObservationIgnored private var cursor: String?
    @ObservationIgnored private var isLoadingMore = false
    /// Bumped by every refresh so a page requested before it is discarded.
    @ObservationIgnored private var generation = 0

    @ObservationIgnored private let loadPage: PageLoader
    @ObservationIgnored private let loadFeeds: FeedsLoader

    init(loadFeeds: @escaping FeedsLoader = { [] }, loadPage: @escaping PageLoader) {
        self.loadFeeds = loadFeeds
        self.loadPage = loadPage
    }

    convenience init(client: AppViewClient) {
        self.init(
            loadFeeds: { try await client.getSuggestedFeeds() },
            loadPage: { feed, cursor in
                try await client.getFeed(feed: feed, limit: FeedConfiguration.pageSize, cursor: cursor)
            }
        )
    }

    var selectedFeed: FeedGeneratorView? {
        feeds.first { $0.uri == selectedFeedURI }
    }

    func loadIfNeeded() async {
        guard phase == .idle else { return }
        phase = .loading
        await refresh()
    }

    /// Switches to `feed`, starting from its first page.
    func select(_ feed: FeedGeneratorView) async {
        guard feed.uri != selectedFeedURI else { return }
        selectedFeedURI = feed.uri
        reels = []
        cursor = nil
        pagingError = nil
        phase = .loading
        await refresh()
    }

    /// Switches to the default feed (Latest, newest first), reloads it, and
    /// asks the view to scroll to `reelID` if it is there.
    func showDefaultFeed(revealing reelID: String) async {
        if let defaultFeed = feeds.first, defaultFeed.uri != selectedFeedURI {
            selectedFeedURI = defaultFeed.uri
            reels = []
            cursor = nil
            pagingError = nil
            phase = .loading
        }
        await refresh()
        if reels.contains(where: { $0.id == reelID }) {
            revealedReelID = reelID
        }
    }

    func didReveal() {
        revealedReelID = nil
    }

    /// Replaces the feed with its first page. On failure the current reels
    /// stay on screen.
    func refresh() async {
        if feeds.isEmpty {
            await listFeeds()
        }
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

    /// A failure leaves the tabs empty and the default feed playing; the next
    /// refresh tries again.
    private func listFeeds() async {
        do {
            feeds = try await loadFeeds()
            if selectedFeedURI == nil {
                // The AppView lists its default first.
                selectedFeedURI = feeds.first?.uri
            }
        } catch {
            print("[feed] could not list feeds: \(error)")
        }
    }

    /// The AppView drops posts it cannot play yet, so a page can come back
    /// empty with a cursor. Follow a few of those before showing nothing.
    private func fetch(after cursor: String?) async throws -> ([VideoPostView], String?) {
        var cursor = cursor
        var posts: [VideoPostView] = []
        let feed = selectedFeedURI
        for _ in 0..<3 {
            let page = try await loadPage(feed, cursor)
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
