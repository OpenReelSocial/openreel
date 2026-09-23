import SwiftUI

struct ContentView: View {
    var body: some View {
        TabView {
            FeedView()
                .monoTabBar()
                .tabItem { Label("Home", systemImage: "house.fill") }
            PlaceholderTabView(title: "Discover")
                .monoTabBar()
                .tabItem { Label("Discover", systemImage: "safari") }
            PlaceholderTabView(title: "Create")
                .monoTabBar()
                .tabItem { Label("Create", systemImage: "plus.app.fill") }
            PlaceholderTabView(title: "Inbox")
                .monoTabBar()
                .tabItem { Label("Inbox", systemImage: "tray") }
            PlaceholderTabView(title: "Profile")
                .monoTabBar()
                .tabItem { Label("Profile", systemImage: "person") }
        }
        .tint(MonoTheme.primary)
        .preferredColorScheme(.dark)
    }
}

/// Stand-in for tabs that don't exist yet.
struct PlaceholderTabView: View {
    let title: String

    var body: some View {
        ZStack {
            MonoTheme.background.ignoresSafeArea()
            Text(title)
                .font(.title2.weight(.semibold))
                .foregroundStyle(MonoTheme.secondary)
        }
    }
}

private extension View {
    /// Tab bar background is set per tab, so every tab applies this.
    func monoTabBar() -> some View {
        toolbarBackground(MonoTheme.background, for: .tabBar)
            .toolbarBackground(.visible, for: .tabBar)
    }
}

#Preview {
    ContentView()
}
