import SwiftUI

/// Vertical, page-snapped short-form feed backed by the AppView. Only the
/// visible reel plays; `FeedPlaybackController` preloads the ones around it.
@MainActor
struct FeedView: View {
    let store: FeedStore
    let playback: FeedPlaybackController

    @State private var visibleReelID: String?
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        content
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.black.ignoresSafeArea())
            .task { await store.loadIfNeeded() }
            .onAppear { playback.resume(.hidden) }
            .onDisappear { playback.suspend(.hidden) }
            .onChange(of: scenePhase, initial: true) { _, phase in
                if phase == .active {
                    playback.resume(.background)
                } else {
                    playback.suspend(.background)
                }
            }
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
        ScrollView(.vertical) {
            LazyVStack(spacing: 0) {
                ForEach(store.reels) { reel in
                    ReelCellView(
                        reel: reel,
                        player: playback.players[reel.id],
                        isFocused: reel.id == playback.focusedID,
                        isPaused: playback.isPausedByUser,
                        hasFailed: playback.failedIDs.contains(reel.id),
                        onTap: { playback.togglePause() }
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
        .refreshable { await store.refresh() }
        .ignoresSafeArea()
        .onAppear(perform: focusVisibleReel)
        .onChange(of: visibleReelID) { _, _ in focusVisibleReel() }
        .onChange(of: store.reels) { _, _ in focusVisibleReel() }
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
        store: FeedStore { _ in MockReelProvider.page },
        playback: FeedPlaybackController()
    )
}
