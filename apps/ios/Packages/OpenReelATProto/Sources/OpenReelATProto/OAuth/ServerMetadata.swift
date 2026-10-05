import Foundation

/// `/.well-known/oauth-protected-resource` on a PDS: points at the single
/// authorization server (the PDS itself, or an entryway) that issues its tokens.
public struct ProtectedResourceMetadata: Decodable, Sendable, Equatable {
    public let resource: String?
    public let authorizationServers: [String]

    private enum CodingKeys: String, CodingKey {
        case resource
        case authorizationServers = "authorization_servers"
    }
}

/// `/.well-known/oauth-authorization-server`. Only the fields this client
/// consults are modelled; the server may send many more.
public struct AuthorizationServerMetadata: Codable, Sendable, Equatable {
    public let issuer: URL
    public let authorizationEndpoint: URL
    public let tokenEndpoint: URL
    public let pushedAuthorizationRequestEndpoint: URL
    public let revocationEndpoint: URL?
    public let scopesSupported: [String]?
    public let dpopSigningAlgValuesSupported: [String]?
    public let codeChallengeMethodsSupported: [String]?
    public let clientIdMetadataDocumentSupported: Bool?
    public let authorizationResponseIssParameterSupported: Bool?

    private enum CodingKeys: String, CodingKey {
        case issuer
        case authorizationEndpoint = "authorization_endpoint"
        case tokenEndpoint = "token_endpoint"
        case pushedAuthorizationRequestEndpoint = "pushed_authorization_request_endpoint"
        case revocationEndpoint = "revocation_endpoint"
        case scopesSupported = "scopes_supported"
        case dpopSigningAlgValuesSupported = "dpop_signing_alg_values_supported"
        case codeChallengeMethodsSupported = "code_challenge_methods_supported"
        case clientIdMetadataDocumentSupported = "client_id_metadata_document_supported"
        case authorizationResponseIssParameterSupported = "authorization_response_iss_parameter_supported"
    }

    public init(issuer: URL, authorizationEndpoint: URL, tokenEndpoint: URL, pushedAuthorizationRequestEndpoint: URL,
                revocationEndpoint: URL? = nil, scopesSupported: [String]? = nil,
                dpopSigningAlgValuesSupported: [String]? = ["ES256"], codeChallengeMethodsSupported: [String]? = ["S256"],
                clientIdMetadataDocumentSupported: Bool? = true, authorizationResponseIssParameterSupported: Bool? = true) {
        self.issuer = issuer
        self.authorizationEndpoint = authorizationEndpoint
        self.tokenEndpoint = tokenEndpoint
        self.pushedAuthorizationRequestEndpoint = pushedAuthorizationRequestEndpoint
        self.revocationEndpoint = revocationEndpoint
        self.scopesSupported = scopesSupported
        self.dpopSigningAlgValuesSupported = dpopSigningAlgValuesSupported
        self.codeChallengeMethodsSupported = codeChallengeMethodsSupported
        self.clientIdMetadataDocumentSupported = clientIdMetadataDocumentSupported
        self.authorizationResponseIssParameterSupported = authorizationResponseIssParameterSupported
    }

    /// The checks the atproto OAuth profile requires before trusting a server.
    /// `fetchedFrom` is the origin the document was downloaded from; `issuer`
    /// must match it exactly or a hostile PDS could point at any issuer.
    func validate(fetchedFrom origin: String, client: OAuthClientConfiguration) throws {
        guard let issuerOrigin = issuer.origin, issuerOrigin == origin, issuer.path.isEmpty || issuer.path == "/" else {
            throw ATProtoError.invalidServerMetadata("issuer \(issuer) does not match \(origin)")
        }
        if issuer.scheme != "https", !(client.allowInsecureLocalhost && issuer.isLoopbackHost) {
            throw ATProtoError.invalidServerMetadata("issuer must use https")
        }
        guard (dpopSigningAlgValuesSupported ?? []).contains("ES256") else {
            throw ATProtoError.invalidServerMetadata("server does not support ES256 DPoP")
        }
        guard (codeChallengeMethodsSupported ?? []).contains("S256") else {
            throw ATProtoError.invalidServerMetadata("server does not support PKCE S256")
        }
        if let supported = scopesSupported, !supported.contains("atproto") {
            throw ATProtoError.invalidServerMetadata("server does not offer the atproto scope")
        }
        if client.isLoopbackClient == false, clientIdMetadataDocumentSupported != true {
            throw ATProtoError.invalidServerMetadata("server does not support client metadata documents")
        }
    }
}

/// Discovers the authorization server for a PDS or a user-entered hostname.
public struct OAuthServerDiscovery: Sendable {
    private let http: HTTPClient
    private let client: OAuthClientConfiguration

    public init(client: OAuthClientConfiguration, transport: any HTTPTransport = URLSessionTransport()) {
        self.http = HTTPClient(transport: transport)
        self.client = client
    }

    /// PDS → protected-resource metadata → authorization-server metadata.
    public func authorizationServer(forPDS pdsURL: URL) async throws -> AuthorizationServerMetadata {
        let resource = try await protectedResourceMetadata(at: pdsURL)
        guard resource.authorizationServers.count == 1,
              let issuer = URL(string: resource.authorizationServers[0]), issuer.origin != nil
        else {
            throw ATProtoError.invalidServerMetadata("PDS must declare exactly one authorization server")
        }
        return try await authorizationServerMetadata(issuer: issuer)
    }

    /// For a user who typed a server instead of a handle. Tries the PDS path
    /// first; a bare entryway without resource metadata is accepted too.
    public func authorizationServer(forHost hostURL: URL) async throws -> AuthorizationServerMetadata {
        do {
            return try await authorizationServer(forPDS: hostURL)
        } catch ATProtoError.invalidServerMetadata {
            return try await authorizationServerMetadata(issuer: hostURL)
        }
    }

    public func protectedResourceMetadata(at pdsURL: URL) async throws -> ProtectedResourceMetadata {
        let url = pdsURL.appending(path: ".well-known/oauth-protected-resource")
        let response = try await http.get(url)
        guard response.statusCode == 200 else {
            throw ATProtoError.invalidServerMetadata("HTTP \(response.statusCode) for \(url)")
        }
        return try response.decodeJSON(ProtectedResourceMetadata.self)
    }

    public func authorizationServerMetadata(issuer: URL) async throws -> AuthorizationServerMetadata {
        guard let origin = issuer.origin, let base = URL(string: origin) else {
            throw ATProtoError.invalidServerMetadata("authorization server URL has no origin: \(issuer)")
        }
        let url = base.appending(path: ".well-known/oauth-authorization-server")
        let response = try await http.get(url)
        guard response.statusCode == 200 else {
            throw ATProtoError.invalidServerMetadata("HTTP \(response.statusCode) for \(url)")
        }
        let metadata = try response.decodeJSON(AuthorizationServerMetadata.self)
        try metadata.validate(fetchedFrom: origin, client: client)
        return metadata
    }
}
