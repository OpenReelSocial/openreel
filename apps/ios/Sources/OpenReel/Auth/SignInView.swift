import SwiftUI

/// Collects a handle, DID, or server address and hands off to the browser.
@MainActor
struct SignInView: View {
    let auth: AuthController
    let message: String?

    @State private var identifier = ""
    @FocusState private var fieldFocused: Bool

    private var isSigningIn: Bool {
        if case .signingIn = auth.phase { return true }
        return false
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField(AppAuthConfiguration.signInPlaceholder, text: $identifier)
                        .textContentType(.username)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                        .submitLabel(.go)
                        .focused($fieldFocused)
                        .onSubmit(submit)
                        .disabled(isSigningIn)
                } header: {
                    Text("Account")
                } footer: {
                    Text("Sign in with any AT Protocol account. You will be sent to your server to approve OpenReel.")
                }

                if let message {
                    Section {
                        Label(message, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.red)
                    }
                }

                Section {
                    if isSigningIn {
                        HStack {
                            ProgressView()
                            Text("Waiting for your server…")
                                .foregroundStyle(.secondary)
                            Spacer()
                            Button("Cancel") { auth.cancelSignIn() }
                        }
                    } else {
                        Button("Sign In", action: submit)
                            .disabled(identifier.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
            }
            .navigationTitle("OpenReel")
            .onAppear { fieldFocused = true }
        }
    }

    private func submit() {
        guard !isSigningIn else { return }
        auth.signIn(identifier: identifier)
    }
}
