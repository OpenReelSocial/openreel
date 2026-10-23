import OpenReelATProto
import SwiftUI

/// Vertical, page-snapped short-form feed backed by the AppView. Only the
/// visible reel plays; `FeedPlaybackController` preloads the ones around it.
@MainActor
struct FeedView: View {
    let store: FeedStore
    let playback: FeedPlaybackController
    let likes: LikeStore

    @State private var visibleReelID: String?
    @State private var isChoosingFeed = false
    /// The 2× badge is briefly confirming a lock; see `isShowingSpeedBadge`.
    @State private var isConfirmingSpeedLock = false
    /// 2× was locked during the current hold, as opposed to a hold that began
    /// on a reel already locked.
    @State private var lockedDuringHold = false
    @Environment(\.scenePhase) private var scenePhase

    private static let speedLockConfirmation: Duration = .milliseconds(750)

    var body: some View {
        // The tabs sit above every state, so a feed that is loading, empty,
        // or failed can still be switched away from.
        ZStack(alignment: .top) {
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            VStack(spacing: 12) {
                if !store.feeds.isEmpty {
                    FeedSwitcherView(
                        feeds: store.feeds,
                        selection: store.selectedFeedURI,
                        onSelect: select,
                        onChooseFeeds: { isChoosingFeed = true }
                    )
                }
                if isShowingSpeedBadge {
                    ReelSpeedBadge(isHeld: playback.isSpeedHeld, isLocked: playback.isSpeedLocked)
                        .transition(.opacity.combined(with: .scale(scale: 0.9)))
                }
            }
            .animation(.easeOut(duration: 0.2), value: isShowingSpeedBadge)
            .sensoryFeedback(.impact(weight: .light), trigger: playback.isSpeedHeld) { _, held in held }
            .sensoryFeedback(.impact(weight: .medium), trigger: playback.isSpeedLocked)
            .opacity(playback.isScrubbing ? 0 : 1)
            .allowsHitTesting(!playback.isScrubbing)
            .animation(.easeOut(duration: 0.2), value: playback.isScrubbing)
        }
        .background(MonoTheme.background.ignoresSafeArea())
        .sheet(isPresented: $isChoosingFeed) {
            FeedPickerView(feeds: store.feeds, selection: store.selectedFeedURI, onSelect: select)
                .preferredColorScheme(.dark)
        }
        .onChange(of: isChoosingFeed) { _, isShown in
            if isShown {
                playback.suspend(.covered)
            } else {
                playback.resume(.covered)
            }
        }
        .task { await store.loadIfNeeded() }
        .onChange(of: scenePhase, initial: true) { _, phase in
            if phase == .active {
                playback.resume(.background)
            } else {
                playback.suspend(.background)
            }
        }
        .onChange(of: playback.isSpeedHeld) { _, held in
            if !held { lockedDuringHold = false }
        }
        .task(id: playback.isSpeedLocked) {
            guard playback.isSpeedLocked else {
                isConfirmingSpeedLock = false
                return
            }
            if playback.isSpeedHeld { lockedDuringHold = true }
            isConfirmingSpeedLock = true
            try? await Task.sleep(for: Self.speedLockConfirmation)
            guard !Task.isCancelled else { return }
            isConfirmingSpeedLock = false
        }
    }

    /// While holding unlocked, to show the swipe-down hint; briefly after
    /// locking, to confirm it; and while holding a reel locked earlier, to
    /// show the swipe-up hint. A locked reel otherwise plays without it.
    private var isShowingSpeedBadge: Bool {
        guard playback.isFastForwarding else { return false }
        if isConfirmingSpeedLock { return true }
        return playback.isSpeedHeld && !(playback.isSpeedLocked && lockedDuringHold)
    }

    @ViewBuilder
    private var content: some View {
        switch store.phase {
        case .idle, .loading:
            ProgressView()
                .tint(.white)
        case let .failed(message):
            statusMessage(message, systemImage: "wifi.exclamationmark")
        case .loaded where store.reels.isEmpty:
            statusMessage("No videos yet. Pull down or try again once something has been posted.", systemImage: "film.stack")
        case .loaded:
            feed
        }
    }

    private var feed: some View {
        // Each reel fills the whole screen, including behind the tab bar, so
        // the next reel never peeks through a translucent bar. The overlays
        // are lifted by the bottom safe area instead.
        GeometryReader { geometry in
            ScrollView(.vertical) {
                LazyVStack(spacing: 0) {
                    ForEach(store.reels) { reel in
                        ReelCellView(
                            reel: reel,
                            player: playback.players[reel.id],
                            isFocused: reel.id == playback.focusedID,
                            // Holding for 2× plays a paused reel.
                            isPaused: playback.isPausedByUser && !playback.isFastForwarding,
                            hasFailed: playback.failedIDs.contains(reel.id),
                            isScrubbing: playback.isScrubbing && reel.id == playback.focusedID,
                            isSpeedLocked: playback.isSpeedLocked && reel.id == playback.focusedID,
                            bottomInset: geometry.safeAreaInsets.bottom,
                            onTap: { playback.togglePause() },
                            onScrub: playback.scrub,
                            onSpeedHold: playback.holdForSpeed,
                            onSpeedLock: playback.lockSpeed,
                            isLiked: likes.isLiked(reel),
                            likeCount: likes.likeCount(reel),
                            onToggleLike: { likes.toggle(reel) }
                        )
                        .containerRelativeFrame(.vertical)
                        .id(reel.id)
                    }
                }
                .scrollTargetLayout()
            }
            .scrollPosition(id: $visibleReelID)
            .scrollTargetBehavior(.paging)
            .scrollIndicators(.hidden)
            // The swipes that lock and release 2× must not page the feed.
            .scrollDisabled(playback.isSpeedHeld)
            .refreshable { await store.refresh() }
            .ignoresSafeArea()
        }
        .onAppear(perform: focusVisibleReel)
        .onChange(of: visibleReelID) { _, _ in focusVisibleReel() }
        .onChange(of: store.reels) { _, _ in focusVisibleReel() }
    }

    /// The scroll view leaves the hierarchy while the new feed loads, so the
    /// outgoing reel is stopped here rather than by `focusVisibleReel`.
    private func select(_ feed: FeedGeneratorView) {
        guard feed.uri != store.selectedFeedURI else { return }
        playback.releaseAll()
        visibleReelID = nil
        Task { await store.select(feed) }
    }

    private func statusMessage(_ text: String, systemImage: String) -> some View {
        VStack(spacing: 16) {
            Image(systemName: systemImage)
                .font(.largeTitle)
            Text(text)
                .multilineTextAlignment(.center)
            Button("Try again") {
                Task { await store.refresh() }
            }
            .buttonStyle(.bordered)
            .tint(.white)
        }
        .foregroundStyle(.white)
        .padding(32)
    }

    /// Points playback at the visible reel and pages in more when near the
    /// end. A refresh can remove the visible reel; fall back to the first.
    private func focusVisibleReel() {
        let reels = store.reels
        guard !reels.isEmpty else {
            playback.releaseAll()
            return
        }
        guard let id = visibleReelID, let index = reels.firstIndex(where: { $0.id == id }) else {
            // Setting the position re-enters through onChange(of: visibleReelID).
            visibleReelID = reels[0].id
            return
        }
        playback.focus(on: index, in: reels)
        Task { await store.loadMoreIfNeeded(currentIndex: index) }
    }
}

#Preview {
    FeedView(
        store: FeedStore(loadFeeds: { MockReelProvider.feeds }, loadPage: { _, _ in MockReelProvider.page }),
        playback: FeedPlaybackController(),
        likes: LikeStore(auth: AuthController())
    )
    .preferredColorScheme(.dark)
}
