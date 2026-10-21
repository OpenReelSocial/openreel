import SwiftUI

/// The app's top-level sections, in tab bar order.
enum AppTab: CaseIterable, Identifiable {
    case home
    case discover
    case create
    case inbox
    case profile

    var id: Self { self }

    var title: String {
        switch self {
        case .home: "Home"
        case .discover: "Discover"
        case .create: "Create"
        case .inbox: "Inbox"
        case .profile: "Profile"
        }
    }

    /// Unfilled; the selected tab adds the fill variant.
    var systemImage: String {
        switch self {
        case .home: "house"
        case .discover: "safari"
        case .create: "plus.app"
        case .inbox: "tray"
        case .profile: "person"
        }
    }
}

/// The sections side by side as full-screen pages: swipe sideways anywhere
/// to move between neighbors, or tap the tab bar to jump. Pages stay alive
/// off screen, so the feed keeps its place.
///
/// A horizontal paging scroll view rather than `TabView`, which only swipes
/// in its page style and then has no tab bar. Vertical swipes still reach
/// the feed's own scroll view.
struct MainTabView<Page: View>: View {
    @Binding var selection: AppTab
    /// Holds the pages still while a gesture inside one needs the finger.
    var isSwipeDisabled = false
    var badgedTab: AppTab?
    @ViewBuilder let page: (AppTab) -> Page

    /// The page scrolled into view; drives and follows `selection`.
    @State private var scrolledTab: AppTab?

    var body: some View {
        GeometryReader { geometry in
            ScrollView(.horizontal) {
                // Not lazy: five pages, and each keeps its state off screen.
                HStack(spacing: 0) {
                    ForEach(AppTab.allCases) { tab in
                        // Sized from the reader, not containerRelativeFrame:
                        // that never settled with the feed's paging scroll
                        // view nested inside and froze the app on launch.
                        page(tab)
                            .frame(width: geometry.size.width, height: geometry.size.height)
                            .id(tab)
                    }
                }
                .scrollTargetLayout()
            }
            .scrollPosition(id: $scrolledTab)
            .scrollTargetBehavior(.paging)
            .scrollIndicators(.hidden)
            .scrollDisabled(isSwipeDisabled)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            MonoTabBar(selection: $selection, badgedTab: badgedTab)
        }
        .background(MonoTheme.background.ignoresSafeArea())
        .onAppear { scrolledTab = selection }
        .onChange(of: scrolledTab) { _, tab in
            if let tab, tab != selection { selection = tab }
        }
        .onChange(of: selection) { _, tab in
            if tab != scrolledTab {
                withAnimation(.snappy) { scrolledTab = tab }
            }
        }
    }
}

/// Black tab bar matching the Mono theme: white for the selected tab, gray
/// for the rest.
struct MonoTabBar: View {
    @Binding var selection: AppTab
    /// Marked with a dot, e.g. Profile when the server is unreachable.
    var badgedTab: AppTab?

    var body: some View {
        HStack(spacing: 0) {
            ForEach(AppTab.allCases) { tab in
                item(tab)
            }
        }
        .padding(.top, 6)
        .background(MonoTheme.background.ignoresSafeArea(edges: .bottom))
    }

    private func item(_ tab: AppTab) -> some View {
        let isSelected = tab == selection
        return Button {
            selection = tab
        } label: {
            VStack(spacing: 3) {
                Image(systemName: tab.systemImage)
                    .symbolVariant(isSelected ? .fill : .none)
                    .font(.system(size: 21, weight: isSelected ? .semibold : .regular))
                    .frame(height: 26)
                    .overlay(alignment: .topTrailing) {
                        if tab == badgedTab {
                            Circle()
                                .fill(.orange)
                                .frame(width: 8, height: 8)
                                .offset(x: 4, y: -1)
                        }
                    }
                Text(tab.title)
                    .font(.system(size: 10, weight: isSelected ? .semibold : .medium))
            }
            .foregroundStyle(isSelected ? MonoTheme.primary : MonoTheme.secondary)
            .frame(maxWidth: .infinity, minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(tab.title)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
        .accessibilityValue(tab == badgedTab ? "Needs attention" : "")
    }
}

/// Stand-in for sections that don't exist yet.
struct PlaceholderTabView: View {
    let tab: AppTab

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: tab.systemImage)
                .font(.system(size: 40, weight: .light))
                .foregroundStyle(MonoTheme.secondary)
            Text(tab.title)
                .font(.title2.weight(.semibold))
                .foregroundStyle(MonoTheme.primary)
            Text("Coming soon")
                .font(.subheadline)
                .foregroundStyle(MonoTheme.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(MonoTheme.background)
    }
}
