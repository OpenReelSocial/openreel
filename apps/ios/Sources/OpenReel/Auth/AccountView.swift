import OpenReelATProto
import SwiftUI

/// Shows who is signed in and where their data lives, with sign-out.
struct AccountView: View {
    let auth: AuthController
    let session: OAuthSession
    /// Set when the server could not be reached on launch.
    let unavailability: ServerUnavailability?

    @Environment(\.dismiss) private var dismiss
    @State private var isSigningOut = false

    var body: some View {
        NavigationStack {
            List {
                if let unavailability {
                    Section {
                        Label(UserFacingError.message(for: unavailability), systemImage: "wifi.exclamationmark")
                            .foregroundStyle(.orange)
                        Button("Try Again") {
                            Task { await auth.restore() }
                        }
                    }
                }

                Section("Identity") {
                    LabeledContent("Handle", value: session.handle.map { "@\($0.rawValue)" } ?? "Unverified")
                    LabeledContent("DID", value: session.did.rawValue)
                        .textSelection(.enabled)
                }

                Section("Server") {
                    LabeledContent("PDS", value: session.pdsURL.absoluteString)
                    LabeledContent("Authorization", value: session.authorizationServer.issuer.absoluteString)
                    if let expiresAt = session.expiresAt {
                        LabeledContent("Token renews", value: expiresAt, format: .relative(presentation: .named))
                    }
                }

                Section {
                    Button("Sign Out", role: .destructive) {
                        isSigningOut = true
                        Task {
                            await auth.signOut()
                            dismiss()
                        }
                    }
                    .disabled(isSigningOut)
                }
            }
            .navigationTitle("Account")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}
