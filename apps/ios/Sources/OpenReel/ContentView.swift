import OpenReelATProto
import SwiftUI

@MainActor
struct ContentView: View {
    @State private var auth = AuthController()
    @State private var feed = FeedStore(client: AppViewClient(serviceURL: Backend.current.appViewURL))
    @State private var playback = FeedPlaybackController()

    var body: some View {
        Group {
            switch auth.phase {
            case .restoring:
                ProgressView("Signing in…")
            case let .signedOut(message):
                SignInView(auth: auth, message: message)
            case .signingIn:
                SignInView(auth: auth, message: nil)
            case .signedIn, .unavailable:
                tabs
            }
        }
        .tint(MonoTheme.primary)
        .preferredColorScheme(.dark)
        .task { await auth.restore() }
    }

    private var tabs: some View {
        TabView {
            // FeedView pauses playback when another tab hides it.
            FeedView(store: feed, playback: playback)
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
            profile
                .monoTabBar()
                .tabItem { Label("Profile", systemImage: "person") }
                .badge(unavailability == nil ? nil : Text("!"))
        }
    }

    /// The account screen until there is a real profile.
    @ViewBuilder
    private var profile: some View {
        if let session = auth.session {
            AccountView(auth: auth, session: session, unavailability: unavailability, isSheet: false)
        } else {
            PlaceholderTabView(title: "Profile")
        }
    }

    private var unavailability: ServerUnavailability? {
        if case let .unavailable(unavailability, _) = auth.phase { return unavailability }
        return nil
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
