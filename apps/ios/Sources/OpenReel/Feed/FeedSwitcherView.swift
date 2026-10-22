import OpenReelATProto
import SwiftUI

/// Feed tabs drawn over the top of the video as a wheel, plus a button that
/// shows how each feed ranks.
///
/// The selected feed sits in the center. Dragging sideways brings each feed
/// to the center with a tick, and the one the wheel comes to rest on is
/// selected; tapping a feed brings it there. Feeds shrink and fade with
/// distance from the center.
struct FeedSwitcherView: View {
    let feeds: [FeedGeneratorView]
    /// URI of the selected feed.
    let selection: String?
    var onSelect: (FeedGeneratorView) -> Void
    var onChooseFeeds: () -> Void = {}

    /// URI of the feed scrolled to the center. Follows `selection`, and
    /// selects once the wheel rests.
    @State private var centeredURI: String?

    /// Every feed gets the same width so the snap lands each one centered.
    nonisolated private static let itemWidth: CGFloat = 112
    private static let height: CGFloat = 44
    /// Selecting reloads the feed, so wait for the wheel to stop rather than
    /// loading every feed it passes.
    private static let settleDelay: Duration = .milliseconds(350)

    var body: some View {
        GeometryReader { geometry in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 0) {
                    ForEach(feeds) { feed in
                        feedTab(feed)
                    }
                }
                .scrollTargetLayout()
            }
            // Lets the first and last feeds reach the center.
            .contentMargins(.horizontal, max(0, (geometry.size.width - Self.itemWidth) / 2), for: .scrollContent)
            .scrollTargetBehavior(.viewAligned)
            .scrollPosition(id: $centeredURI, anchor: .center)
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
        .onAppear { centeredURI = selection }
        .onChange(of: selection) { _, uri in
            if uri != centeredURI {
                withAnimation(.snappy) { centeredURI = uri }
            }
        }
        .task(id: centeredURI) {
            guard let centeredURI, centeredURI != selection,
                  let feed = feeds.first(where: { $0.uri == centeredURI })
            else { return }
            try? await Task.sleep(for: Self.settleDelay)
            guard !Task.isCancelled else { return }
            onSelect(feed)
        }
        // Not for the first centering when the tabs appear.
        .sensoryFeedback(.selection, trigger: centeredURI) { old, new in old != nil && new != nil }
    }

    private func feedTab(_ feed: FeedGeneratorView) -> some View {
        // The centered feed reads as selected while the wheel moves.
        let isSelected = feed.uri == (centeredURI ?? selection)
        return Button {
            withAnimation(.snappy) { centeredURI = feed.uri }
        } label: {
            VStack(spacing: 4) {
                Text(feed.displayName)
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
