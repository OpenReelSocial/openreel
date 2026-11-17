import Foundation
import Observation
import OpenReelATProto

/// The feed's contents: which feeds the AppView offers, how the viewer
/// arranged them (`FeedPreferences`, saved on the device), which is selected,
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
    /// Finds the feeds another generator serves, from a domain the viewer typed.
    typealias FeedLookup = @Sendable (_ domain: String) async throws -> (host: String, feeds: [FeedGeneratorView])

    private(set) var phase: Phase = .idle
    /// Feeds the AppView offers, default first. Empty until listed, or if the
    /// AppView could not list them; the default feed still plays.
    private(set) var feeds: [FeedGeneratorView] = []
    /// The viewer's tab order, hidden feeds, and feeds added from elsewhere.
    private(set) var preferences: FeedPreferences
    /// URI of the feed being shown; `nil` means the AppView's default.
    private(set) var selectedFeedURI: String?
    /// Everything loaded for the selected feed, including reels the
    /// viewer's moderation preferences hide.
    private(set) var loadedReels: [Reel] = []
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
    @ObservationIgnored private let lookUp: FeedLookup
    /// Where `preferences` is saved; `nil` keeps them in memory (previews).
    @ObservationIgnored private let defaults: UserDefaults?
    let moderation: ModerationController

    static let preferencesKey = "feedPreferences"

    init(loadFeeds: @escaping FeedsLoader = { [] }, loadPage: @escaping PageLoader,
         lookUp: @escaping FeedLookup = { throw FeedLookupError.invalidDomain($0) },
         moderation: ModerationController? = nil, defaults: UserDefaults? = nil) {
        self.loadFeeds = loadFeeds
        self.loadPage = loadPage
        self.lookUp = lookUp
        self.moderation = moderation ?? ModerationController()
        self.defaults = defaults
        preferences = defaults?.data(forKey: Self.preferencesKey)
            .flatMap { try? JSONDecoder().decode(FeedPreferences.self, from: $0) } ?? FeedPreferences()
    }

    convenience init(client: AppViewClient, moderation: ModerationController) {
        let directory = FeedGeneratorDirectory()
        self.init(
            loadFeeds: { try await client.getSuggestedFeeds() },
            loadPage: { feed, cursor in
                try await client.getFeed(feed: feed, limit: FeedConfiguration.pageSize, cursor: cursor)
            },
            lookUp: { try await directory.feeds(at: $0) },
            moderation: moderation,
            defaults: .standard
        )
    }

    /// The reels to show: what is loaded, minus what the viewer's moderation
    /// preferences hide. Changing a preference updates it immediately.
    var reels: [Reel] {
        loadedReels.filter { !moderation.isHidden($0) }
    }

    var selectedFeed: FeedGeneratorView? {
        preferences.available(suggested: feeds).first { $0.uri == selectedFeedURI }
    }

    // MARK: - Arranging feeds

    /// The feeds shown as tabs over the video, in the viewer's order.
    var tabFeeds: [FeedGeneratorView] {
        preferences.tabs(suggested: feeds)
    }

    /// Feeds the viewer hid from the tabs.
    var hiddenFeeds: [FeedGeneratorView] {
        preferences.hiddenFeeds(suggested: feeds)
    }

    func isAdded(_ feed: FeedGeneratorView) -> Bool {
        preferences.isAdded(feed.uri)
    }

    /// At least one tab always stays.
    func canHide(_ feed: FeedGeneratorView) -> Bool {
        preferences.canHide(feed.uri, suggested: feeds)
    }

    func setTabOrder(_ tabs: [FeedGeneratorView]) {
        updatePreferences { $0.setTabOrder(tabs.map(\.uri)) }
    }

    func hide(_ feed: FeedGeneratorView) {
        guard canHide(feed) else { return }
        updatePreferences { $0.hide(feed.uri) }
    }

    func show(_ feed: FeedGeneratorView) {
        let tabs = tabFeeds.map(\.uri)
        updatePreferences {
            $0.setTabOrder(tabs)
            $0.show(feed.uri)
        }
    }

    func add(_ added: [FeedGeneratorView]) {
        let tabs = tabFeeds.map(\.uri)
        updatePreferences {
            $0.setTabOrder(tabs)
            $0.add(added)
        }
    }

    /// Forgets a feed the viewer added; the AppView's own feeds can only be hidden.
    func remove(_ feed: FeedGeneratorView) {
        guard isAdded(feed), canHide(feed) || hiddenFeeds.contains(feed) else { return }
        updatePreferences { $0.remove(feed.uri) }
    }

    /// The feeds served at the domain the viewer typed.
    func lookUpFeeds(at domain: String) async throws -> (host: String, feeds: [FeedGeneratorView]) {
        try await lookUp(domain)
    }

    private func updatePreferences(_ change: (inout FeedPreferences) -> Void) {
        change(&preferences)
        if let defaults, let data = try? JSONEncoder().encode(preferences) {
            defaults.set(data, forKey: Self.preferencesKey)
        }
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
        loadedReels = []
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
            loadedReels = []
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
        if loadedReels.isEmpty { phase = .loading }
        do {
            let (posts, next) = try await fetch(after: nil)
            guard current == generation else { return }
            loadedReels = Self.unique(posts.map(Reel.init(post:)), excluding: [])
            cursor = next
            pagingError = nil
            phase = .loaded
        } catch {
            guard current == generation else { return }
            let message = UserFacingError.message(for: error)
            if loadedReels.isEmpty {
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
            loadedReels += Self.unique(posts.map(Reel.init(post:)), excluding: Set(loadedReels.map(\.id)))
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
                // The first tab: the AppView lists its default first, but the
                // viewer may have reordered or hidden it.
                selectedFeedURI = tabFeeds.first?.uri ?? feeds.first?.uri
            }
        } catch {
            print("[feed] could not list feeds: \(error)")
        }
    }

    /// The AppView drops posts it cannot play yet, so a page can come back
    /// empty with a cursor, and the viewer's preferences can hide every post
    /// on a page. Follow a few of those before showing nothing.
    private func fetch(after cursor: String?) async throws -> ([VideoPostView], String?) {
        var cursor = cursor
        var posts: [VideoPostView] = []
        let feed = selectedFeedURI
        for _ in 0..<3 {
            let page = try await loadPage(feed, cursor)
            posts += page.feed
            cursor = page.cursor
            let showsSomething = posts.contains { !moderation.isHidden(Reel(post: $0)) }
            if showsSomething || cursor == nil { break }
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
