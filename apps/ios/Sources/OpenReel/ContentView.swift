import OpenReelATProto
import SwiftUI

@MainActor
struct ContentView: View {
    @State private var auth = AuthController()
    @State private var showingAccount = false

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
                feed
            }
        }
        .task { await auth.restore() }
    }

    private var feed: some View {
        ZStack(alignment: .topTrailing) {
            FeedView()
            // FeedView ignores the safe area; this ZStack does not, so the
            // button lands below the status bar.
            Button {
                showingAccount = true
            } label: {
                Image(systemName: unavailability == nil ? "person.crop.circle" : "person.crop.circle.badge.exclamationmark")
                    .font(.title2)
                    .foregroundStyle(.white)
                    .padding()
            }
            .accessibilityLabel("Account")
        }
        .sheet(isPresented: $showingAccount) {
            if let session = auth.session {
                AccountView(auth: auth, session: session, unavailability: unavailability)
            }
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
