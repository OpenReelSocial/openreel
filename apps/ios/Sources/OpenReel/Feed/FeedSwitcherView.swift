import SwiftUI

/// Row of feed tabs drawn over the top of the video, plus a button to manage
/// which feeds appear here.
struct FeedSwitcherView: View {
    let feeds: [String]
    @Binding var selection: String
    var onChooseFeeds: () -> Void = {}

    var body: some View {
        HStack(spacing: 8) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 18) {
                    ForEach(feeds, id: \.self) { feed in
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

    private func feedTab(_ feed: String) -> some View {
        let isSelected = feed == selection
        return Button {
            selection = feed
        } label: {
            VStack(spacing: 4) {
                Text(feed)
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
