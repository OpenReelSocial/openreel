import SwiftUI

/// Feed tabs drawn over the top of the video as a wheel: the selected feed
/// sits in the center, dragging sideways selects whichever feed snaps to the
/// center (with a tick as each one passes), and tapping a feed brings it
/// there. Feeds shrink and fade with distance from the center. A button on
/// the right manages which feeds appear here.
struct FeedSwitcherView: View {
    let feeds: [String]
    @Binding var selection: String
    var onChooseFeeds: () -> Void = {}

    /// The feed scrolled to the center; drives and follows `selection`.
    @State private var centeredFeed: String?

    /// Every feed gets the same width so the snap lands each one centered.
    nonisolated private static let itemWidth: CGFloat = 96
    private static let height: CGFloat = 44

    var body: some View {
        GeometryReader { geometry in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 0) {
                    ForEach(feeds, id: \.self) { feed in
                        feedTab(feed)
                    }
                }
                .scrollTargetLayout()
            }
            // Lets the first and last feeds reach the center.
            .contentMargins(.horizontal, max(0, (geometry.size.width - Self.itemWidth) / 2), for: .scrollContent)
            .scrollTargetBehavior(.viewAligned)
            .scrollPosition(id: $centeredFeed, anchor: .center)
            .mask(edgeFade)
        }
        .frame(height: Self.height)
        .overlay(alignment: .trailing) {
            Button(action: onChooseFeeds) {
                Image(systemName: "line.3.horizontal.decrease")
                    .font(.system(size: 20, weight: .medium))
                    .foregroundStyle(MonoTheme.primary)
                    .frame(width: 44, height: 44)
            }
            .accessibilityLabel("Choose feeds")
            .padding(.trailing, 8)
        }
        .onAppear { centeredFeed = selection }
        .onChange(of: centeredFeed) { _, feed in
            if let feed, feed != selection { selection = feed }
        }
        .onChange(of: selection) { _, feed in
            if feed != centeredFeed {
                withAnimation(.snappy) { centeredFeed = feed }
            }
        }
        .sensoryFeedback(.selection, trigger: selection)
    }

    private func feedTab(_ feed: String) -> some View {
        let isSelected = feed == selection
        return Button {
            withAnimation(.snappy) { selection = feed }
        } label: {
            VStack(spacing: 4) {
                Text(feed)
                    .font(.system(size: 16, weight: .semibold))
                    .lineLimit(1)
                    .foregroundStyle(isSelected ? MonoTheme.primary : MonoTheme.inactiveOverlay)
                Capsule()
                    .fill(isSelected ? MonoTheme.accent : .clear)
                    .frame(width: 20, height: 3)
            }
            .frame(width: Self.itemWidth, height: Self.height)
            .contentShape(Rectangle())
        }
        .visualEffect { content, proxy in
            let falloff = Self.falloff(proxy)
            return content
                .scaleEffect(1 - 0.15 * falloff)
                .opacity(1 - 0.55 * falloff)
        }
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    /// 0 for a feed in the center of the wheel, rising to 1 two feeds away.
    nonisolated private static func falloff(_ proxy: GeometryProxy) -> Double {
        guard let viewport = proxy.bounds(of: .scrollView(axis: .horizontal)) else { return 0 }
        let distance = abs(viewport.midX - proxy.size.width / 2)
        return min(distance / (itemWidth * 2), 1)
    }

    private var edgeFade: some View {
        LinearGradient(
            stops: [
                .init(color: .clear, location: 0),
                .init(color: .black, location: 0.2),
                .init(color: .black, location: 0.8),
                .init(color: .clear, location: 1),
            ],
            startPoint: .leading,
            endPoint: .trailing
        )
    }
}
