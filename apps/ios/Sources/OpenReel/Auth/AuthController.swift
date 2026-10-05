import Foundation
import Observation
import OpenReelATProto

/// Drives the sign-in UI from the session manager. Owns the browser handoff
/// and maps protocol failures to the phases the views render.
@MainActor
@Observable
final class AuthController {
    enum Phase: Equatable {
        /// Reading the Keychain and, if needed, refreshing on launch.
        case restoring
        case signedOut(message: String?)
        case signingIn
        case signedIn(OAuthSession)
        /// A stored session exists but its server could not be reached. The
        /// user stays signed in locally and can retry or sign out.
        case unavailable(ServerUnavailability, session: OAuthSession)
    }

    private(set) var phase: Phase = .restoring

    let manager: ATProtoSessionManager
    private let presenter = WebAuthenticationPresenter()
    private var signInTask: Task<Void, Never>?

    init(manager: ATProtoSessionManager) {
        self.manager = manager
    }

    convenience init() {
        self.init(manager: ATProtoSessionManager(
            client: AppAuthConfiguration.client,
            identity: AppAuthConfiguration.identity,
            store: KeychainSessionStore()
        ))
    }

    var session: OAuthSession? {
        switch phase {
        case let .signedIn(session), let .unavailable(_, session): return session
        default: return nil
        }
    }

    // MARK: - Lifecycle

    func restore() async {
        if case .signingIn = phase { return }
        if session == nil { phase = .restoring }
        do {
            if let session = try await manager.restore() {
                phase = .signedIn(session)
            } else {
                phase = .signedOut(message: nil)
            }
        } catch let ATProtoError.serverUnavailable(unavailability) {
            if let kept = await manager.session {
                phase = .unavailable(unavailability, session: kept)
            } else {
                phase = .signedOut(message: UserFacingError.message(for: unavailability))
            }
        } catch {
            // `sessionExpired` and anything else that cleared the session.
            phase = .signedOut(message: UserFacingError.message(for: error))
        }
    }

    func signIn(identifier: String) {
        guard signInTask == nil else { return }
        phase = .signingIn
        signInTask = Task {
            defer { signInTask = nil }
            do {
                let session = try await performSignIn(identifier: identifier)
                phase = .signedIn(session)
            } catch is CancellationError {
                phase = .signedOut(message: nil)
            } catch {
                phase = .signedOut(message: UserFacingError.message(for: error))
            }
        }
    }

    func cancelSignIn() {
        signInTask?.cancel()
        presenter.cancel()
    }

    func signOut() async {
        await manager.signOut()
        phase = .signedOut(message: nil)
    }

    // MARK: - Private

    private func performSignIn(identifier: String) async throws -> OAuthSession {
        #if DEBUG
        if AppAuthConfiguration.client.isLoopbackClient {
            return try await performLoopbackSignIn(identifier: identifier)
        }
        #endif
        let pending = try await manager.beginSignIn(identifier: identifier)
        let callbackURL = try await presenter.authenticate(
            url: pending.authorizationURL,
            callbackURLScheme: AppAuthConfiguration.callbackURLScheme
        )
        return try await manager.completeSignIn(callbackURL: callbackURL, pending: pending)
    }

    #if DEBUG
    /// Loopback flow: the browser cannot deliver an `http://127.0.0.1` redirect
    /// to the app, so a one-shot local listener receives it and the browser
    /// sheet is dismissed programmatically.
    private func performLoopbackSignIn(identifier: String) async throws -> OAuthSession {
        let listener = try LoopbackRedirectListener(path: AppAuthConfiguration.callbackPath)
        defer { listener.stop() }
        let port = try await listener.start()
        let pending = try await manager.beginSignIn(
            identifier: identifier,
            redirectURI: "http://127.0.0.1:\(port)\(AppAuthConfiguration.callbackPath)"
        )

        let presenter = self.presenter
        let callbackURL = try await withThrowingTaskGroup(of: URL.self) { group in
            group.addTask { try await listener.callbackURL() }
            group.addTask { try await presenter.authenticate(url: pending.authorizationURL, callbackURLScheme: nil) }
            // Whichever finishes first wins: the listener on success, the
            // browser when the user dismisses it.
            guard let first = try await group.next() else { throw CancellationError() }
            group.cancelAll()
            return first
        }
        return try await manager.completeSignIn(callbackURL: callbackURL, pending: pending)
    }
    #endif
}
