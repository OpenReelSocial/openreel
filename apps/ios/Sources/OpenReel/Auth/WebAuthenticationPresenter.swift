import AuthenticationServices
import UIKit

/// `async` wrapper around `ASWebAuthenticationSession`. One session at a time;
/// cancelling the surrounding task dismisses the browser.
@MainActor
final class WebAuthenticationPresenter: NSObject, ASWebAuthenticationPresentationContextProviding {
    private var session: ASWebAuthenticationSession?

    /// Opens `url` and resolves with the redirect the browser was sent to.
    /// `callbackURLScheme` is `nil` for loopback (`http://127.0.0.1`) redirects,
    /// which the browser cannot hand back; the caller catches those itself and
    /// cancels this task.
    func authenticate(url: URL, callbackURLScheme: String?) async throws -> URL {
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                let session = ASWebAuthenticationSession(url: url, callbackURLScheme: callbackURLScheme) { [weak self] callbackURL, error in
                    Task { @MainActor in self?.session = nil }
                    if let callbackURL {
                        continuation.resume(returning: callbackURL)
                    } else {
                        continuation.resume(throwing: error ?? ASWebAuthenticationSessionError(.canceledLogin))
                    }
                }
                session.presentationContextProvider = self
                // Sign-in state should not leak between accounts via shared cookies.
                session.prefersEphemeralWebBrowserSession = true
                self.session = session
                if !session.start() {
                    self.session = nil
                    continuation.resume(throwing: ASWebAuthenticationSessionError(.presentationContextInvalid))
                }
            }
        } onCancel: {
            Task { @MainActor in self.cancel() }
        }
    }

    func cancel() {
        session?.cancel()
        session = nil
    }

    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .flatMap(\.windows)
                .first { $0.isKeyWindow } ?? ASPresentationAnchor()
        }
    }
}
