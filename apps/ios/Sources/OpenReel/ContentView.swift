import OpenReelATProto
import SwiftUI

@MainActor
struct ContentView: View {
    @State private var auth = AuthController()
    @State private var feed = FeedStore(client: AppViewClient(serviceURL: Backend.current.appViewURL))
    @State private var playback = FeedPlaybackController()
    @State private var selectedTab = AppTab.home

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
        MainTabView(
            selection: $selectedTab,
            // The scrubber and the 2× swipes need sideways and vertical
            // movement for themselves.
            isSwipeDisabled: playback.isScrubbing || playback.isSpeedHeld,
            badgedTab: unavailability == nil ? nil : .profile
        ) { tab in
            switch tab {
            case .home:
                FeedView(store: feed, playback: playback)
            case .profile:
                profile
            case .discover, .create, .inbox:
                PlaceholderTabView(tab: tab)
            }
        }
        // Every page stays alive, so the feed plays only while it is the
        // page on screen.
        .onChange(of: selectedTab, initial: true) { _, tab in
            if tab == .home {
                playback.resume(.hidden)
            } else {
                playback.suspend(.hidden)
            }
        }
        .onDisappear { playback.suspend(.hidden) }
    }

    @ViewBuilder
    private var profile: some View {
        if let session = auth.session {
            ProfileView(
                auth: auth,
                session: session,
                unavailability: unavailability,
                reels: feed.reels.filter { $0.authorDID == session.did.rawValue }
            )
        } else {
            PlaceholderTabView(tab: .profile)
        }
    }

    private var unavailability: ServerUnavailability? {
        if case let .unavailable(unavailability, _) = auth.phase { return unavailability }
        return nil
    }
}

#Preview {
    ContentView()
}
