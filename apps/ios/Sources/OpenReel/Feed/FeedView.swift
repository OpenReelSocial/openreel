import SwiftUI

/// Vertical, page-snapped short-form feed. Only the currently visible cell
/// plays; every other cell stays paused.
struct FeedView: View {
    let reels: [Reel]

    @State private var visibleReelID: String?

    init(reels: [Reel] = MockReelProvider.reels) {
        self.reels = reels
    }

    var body: some View {
        ScrollView(.vertical) {
            LazyVStack(spacing: 0) {
                ForEach(reels) { reel in
                    ReelCellView(reel: reel, isActive: reel.id == visibleReelID)
                        .containerRelativeFrame(.vertical)
                        .id(reel.id)
                }
            }
            .scrollTargetLayout()
        }
        .scrollPosition(id: $visibleReelID)
        .scrollTargetBehavior(.paging)
        .ignoresSafeArea()
        .background(Color.black)
        .onAppear {
            if visibleReelID == nil {
                visibleReelID = reels.first?.id
            }
        }
    }
}

#Preview {
    FeedView()
}
