import Foundation

/// Every failure surfaced by this package. Cases are deliberately coarse so the
/// UI can map them to a handful of user-facing states (server unavailable,
/// session expired, bad identifier, ...) without inspecting transport details.
public enum ATProtoError: Error, Equatable, Sendable {
    /// A PDS, authorization server, PLC directory, or handle host could not be
    /// reached or failed server-side. The local session, if any, is still valid.
    case serverUnavailable(ServerUnavailability)

    /// The string the user entered is not a handle, DID, or server URL.
    case invalidIdentifier(String)

    /// The handle or DID is syntactically fine but nothing resolves for it.
    case identityNotFound(String)

    /// The DID document does not claim the handle that resolved to it.
    case handleMismatch(handle: String, did: String)

    /// A DID resolved but its document is unusable (no PDS endpoint, bad JSON).
    case didResolutionFailed(did: String, detail: String)

    /// Resource-server or authorization-server metadata failed validation.
    case invalidServerMetadata(String)

    /// The authorization server rejected the flow (`access_denied`, etc.) or
    /// the token/PAR endpoint returned an OAuth error.
    case oauth(error: String, description: String?)

    /// The redirect carried a `state` that does not belong to the pending flow.
    case stateMismatch

    /// The redirect's `iss` does not match the authorization server we used.
    case issuerMismatch(expected: String, received: String?)

    /// The token response is for a different account than the one requested.
    case accountMismatch(expected: String, received: String)

    /// The refresh token was rejected; the user must sign in again.
    case sessionExpired

    /// An authenticated call was attempted with no stored session.
    case notSignedIn

    /// An XRPC endpoint returned a 4xx error body.
    case xrpc(status: Int, error: String?, message: String?)

    /// A response could not be parsed into the expected shape.
    case invalidResponse(String)
}

/// Why a server counts as unavailable. Kept separate from `ATProtoError` so UI
/// can distinguish "you are offline" from "the PDS is down".
public enum ServerUnavailability: Equatable, Sendable {
    case offline
    case unreachable(host: String)
    case timedOut(host: String)
    case serverError(host: String, status: Int)

    public var host: String? {
        switch self {
        case .offline: return nil
        case let .unreachable(host), let .timedOut(host), let .serverError(host, _): return host
        }
    }

    static func from(_ error: URLError, host: String?) -> ServerUnavailability {
        let host = host ?? "unknown host"
        switch error.code {
        case .notConnectedToInternet, .internationalRoamingOff, .dataNotAllowed:
            return .offline
        case .timedOut:
            return .timedOut(host: host)
        default:
            return .unreachable(host: host)
        }
    }
}
