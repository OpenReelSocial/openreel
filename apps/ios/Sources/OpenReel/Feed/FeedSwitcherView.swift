import OpenReelATProto
import SwiftUI

/// Row of feed tabs drawn over the top of the video, plus a button that shows
/// how each feed ranks.
struct FeedSwitcherView: View {
    let feeds: [FeedGeneratorView]
    /// URI of the selected feed.
    let selection: String?
    var onSelect: (FeedGeneratorView) -> Void
    var onChooseFeeds: () -> Void = {}

    var body: some View {
        HStack(spacing: 8) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 18) {
                    ForEach(feeds) { feed in
                        feedTab(feed)
                    }
                }
            }

            Button(action: onChooseFeeds) {
                Image(systemName: "line.3.horizontal.decrease")
                    .font(.system(size: 20, weight: .medium))
                    .foregroundStyle(MonoTheme.primary)
                    .frame(width: 44, height: 44)
            }
            .accessibilityLabel("Choose feeds")
        }
        .padding(.horizontal, 16)
    }

    private func feedTab(_ feed: FeedGeneratorView) -> some View {
        let isSelected = feed.uri == selection
        return Button {
            onSelect(feed)
        } label: {
            VStack(spacing: 4) {
                Text(feed.displayName)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(isSelected ? MonoTheme.primary : MonoTheme.inactiveOverlay)
                Capsule()
                    .fill(isSelected ? MonoTheme.accent : .clear)
                    .frame(width: 20, height: 3)
            }
            .frame(minHeight: 44)
        }
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}
