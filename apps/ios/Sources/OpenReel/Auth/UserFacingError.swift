import AuthenticationServices
import Foundation
import OpenReelATProto

/// Turns protocol-level failures into one sentence the sign-in screen can show.
enum UserFacingError {
    static func message(for error: Error) -> String {
        if let error = error as? ATProtoError {
            return message(for: error)
        }
        if let error = error as? ASWebAuthenticationSessionError, error.code == .canceledLogin {
            return "Sign-in was cancelled."
        }
        return "Something went wrong. Please try again."
    }

    static func message(for error: ATProtoError) -> String {
        switch error {
        case let .serverUnavailable(unavailability):
            return message(for: unavailability)
        case .invalidIdentifier:
            return "Enter a handle like alice.example.com, a DID, or your server's address."
        case let .identityNotFound(identifier):
            return "No account was found for \(identifier)."
        case .handleMismatch:
            return "That handle does not point back to the account that claims it."
        case .didResolutionFailed:
            return "Could not look up this account's server."
        case .invalidServerMetadata:
            return "That server does not support signing in with OpenReel."
        case let .oauth(code, description):
            switch code {
            case "access_denied", "login_required", "consent_required":
                return "Sign-in was not completed."
            default:
                return description ?? "The server rejected the sign-in request (\(code))."
            }
        case .stateMismatch, .issuerMismatch:
            return "The sign-in response could not be verified. Please try again."
        case .accountMismatch:
            return "You signed in to a different account than the one you entered."
        case .sessionExpired:
            return "Your session has expired. Please sign in again."
        case .notSignedIn:
            return "You are not signed in."
        case .xrpc, .invalidResponse:
            return "The server sent an unexpected response."
        }
    }

    static func message(for unavailability: ServerUnavailability) -> String {
        switch unavailability {
        case .offline:
            return "You appear to be offline."
        case let .unreachable(host):
            return "Could not reach \(host)."
        case let .timedOut(host):
            return "\(host) took too long to respond."
        case let .serverError(host, status):
            return "\(host) is having trouble right now (HTTP \(status))."
        }
    }
}
