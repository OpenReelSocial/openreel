import Foundation

public struct PushedAuthorizationResponse: Decodable, Sendable, Equatable {
    public let requestURI: String
    public let expiresIn: Int?

    private enum CodingKeys: String, CodingKey {
        case requestURI = "request_uri"
        case expiresIn = "expires_in"
    }
}

public struct OAuthTokenResponse: Decodable, Sendable, Equatable {
    public let accessToken: String
    public let tokenType: String
    public let refreshToken: String?
    public let expiresIn: Int?
    public let scope: String?
    /// The account DID. Clients must verify it; see `ATProtoSessionManager`.
    public let sub: String

    private enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case tokenType = "token_type"
        case refreshToken = "refresh_token"
        case expiresIn = "expires_in"
        case scope
        case sub
    }

    public var scopes: Set<String> {
        Set((scope ?? "").split(separator: " ").map(String.init))
    }
}

/// Talks to one authorization server's PAR, token, and revocation endpoints
/// with DPoP. An actor because the server nonce is shared mutable state that
/// every request reads and every response may rotate.
public actor OAuthTokenClient {
    public let metadata: AuthorizationServerMetadata
    private let client: OAuthClientConfiguration
    private let http: HTTPClient
    private let proofs: DPoPProofGenerator
    private var nonce: String?

    public init(metadata: AuthorizationServerMetadata, client: OAuthClientConfiguration,
                key: any DPoPSigningKey, transport: any HTTPTransport, nonce: String? = nil) {
        self.metadata = metadata
        self.client = client
        self.http = HTTPClient(transport: transport)
        self.proofs = DPoPProofGenerator(key: key)
        self.nonce = nonce
    }

    public var currentNonce: String? { nonce }

    public func pushAuthorizationRequest(_ parameters: [String: String]) async throws -> PushedAuthorizationResponse {
        var form = parameters
        form["client_id"] = client.clientID
        let response = try await post(metadata.pushedAuthorizationRequestEndpoint, form: form)
        guard response.statusCode == 201 || response.statusCode == 200 else {
            throw Self.oauthError(response)
        }
        return try response.decodeJSON(PushedAuthorizationResponse.self)
    }

    public func exchangeCode(_ code: String, codeVerifier: String, redirectURI: String) async throws -> OAuthTokenResponse {
        let response = try await post(metadata.tokenEndpoint, form: [
            "grant_type": "authorization_code",
            "code": code,
            "code_verifier": codeVerifier,
            "redirect_uri": redirectURI,
            "client_id": client.clientID,
        ])
        guard response.isSuccess else { throw Self.oauthError(response) }
        return try Self.validated(try response.decodeJSON(OAuthTokenResponse.self))
    }

    /// `invalid_grant` here means the refresh token is spent, revoked, or past
    /// its lifetime: the session is over and the caller must sign out.
    public func refresh(refreshToken: String) async throws -> OAuthTokenResponse {
        let response = try await post(metadata.tokenEndpoint, form: [
            "grant_type": "refresh_token",
            "refresh_token": refreshToken,
            "client_id": client.clientID,
        ])
        guard response.isSuccess else {
            let error = Self.oauthError(response)
            if case let .oauth(code, _) = error, code == "invalid_grant" || code == "invalid_token" {
                throw ATProtoError.sessionExpired
            }
            throw error
        }
        return try Self.validated(try response.decodeJSON(OAuthTokenResponse.self))
    }

    /// RFC 7009. Servers answer 200 even for unknown tokens, so this only
    /// throws on transport failure or a missing endpoint.
    public func revoke(token: String) async throws {
        guard let endpoint = metadata.revocationEndpoint else { return }
        let response = try await post(endpoint, form: [
            "token": token,
            "client_id": client.clientID,
        ])
        guard response.isSuccess else { throw Self.oauthError(response) }
    }

    // MARK: - Private

    /// Form POST with a DPoP proof. Retries exactly once when the server asks
    /// for a fresh nonce, and remembers whatever nonce it hands back.
    private func post(_ endpoint: URL, form: [String: String]) async throws -> HTTPResponse {
        var response = try await send(endpoint, form: form)
        if DPoPResponse.requiresNewNonce(response), DPoPResponse.nonce(response) != nil {
            response = try await send(endpoint, form: form)
        }
        return response
    }

    private func send(_ endpoint: URL, form: [String: String]) async throws -> HTTPResponse {
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(try proofs.proof(method: "POST", url: endpoint, nonce: nonce), forHTTPHeaderField: "DPoP")
        request.httpBody = FormEncoding.encode(form)
        let response = try await http.send(request)
        if let fresh = DPoPResponse.nonce(response) {
            nonce = fresh
        }
        return response
    }

    private static func oauthError(_ response: HTTPResponse) -> ATProtoError {
        if let body = try? JSONDecoder().decode(OAuthErrorBody.self, from: response.body) {
            return .oauth(error: body.error, description: body.errorDescription)
        }
        return .invalidResponse("HTTP \(response.statusCode) from authorization server")
    }

    private static func validated(_ token: OAuthTokenResponse) throws -> OAuthTokenResponse {
        guard token.tokenType.lowercased() == "dpop" else {
            throw ATProtoError.invalidResponse("expected a DPoP-bound token, got \(token.tokenType)")
        }
        guard token.scopes.contains("atproto") else {
            throw ATProtoError.oauth(error: "invalid_scope", description: "server did not grant the atproto scope")
        }
        return token
    }
}
