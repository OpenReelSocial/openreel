import SwiftUI

/// Vertical, page-snapped short-form feed. Only the currently visible cell
/// plays; every other cell stays paused.
struct FeedView: View {
    let reels: [Reel]

    @State private var visibleReelID: String?
    @State private var selectedFeed = MockReelProvider.defaultFeed

    init(reels: [Reel] = MockReelProvider.reels) {
        self.reels = reels
    }

    var body: some View {
        // Each reel fills the whole screen, including behind the tab bar, so
        // the next reel never peeks through a translucent bar. The overlays
        // are lifted by the bottom safe area instead.
        GeometryReader { geometry in
            ZStack(alignment: .top) {
                ScrollView(.vertical) {
                    LazyVStack(spacing: 0) {
                        ForEach(reels) { reel in
                            ReelCellView(
                                reel: reel,
                                isActive: reel.id == visibleReelID,
                                bottomInset: geometry.safeAreaInsets.bottom
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
                .ignoresSafeArea()

                FeedSwitcherView(feeds: MockReelProvider.feedNames, selection: $selectedFeed)
            }
        }
        .background(MonoTheme.background)
        .onAppear {
            if visibleReelID == nil {
                visibleReelID = reels.first?.id
            }
        }
    }
}

#Preview {
    FeedView()
        .preferredColorScheme(.dark)
}
