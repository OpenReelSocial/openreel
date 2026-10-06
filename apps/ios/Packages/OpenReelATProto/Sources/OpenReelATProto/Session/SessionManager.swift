import Foundation

/// State handed to the caller between opening the browser and receiving the
/// redirect. Holds the only copy of the PKCE verifier and the DPoP key, so it
/// must not be persisted anywhere but memory.
public struct PendingAuthorization: Sendable {
    /// Open this in the system browser / `ASWebAuthenticationSession`.
    public let authorizationURL: URL
    public let redirectURI: String
    /// The account the user asked for, when the flow started from a handle or
    /// DID. `nil` when the user typed a server and picks the account there.
    public let expectedIdentity: ResolvedIdentity?
    let state: String
    let pkce: PKCE
    let server: AuthorizationServerMetadata
    let dpopKey: Data
    let authorizationServerNonce: String?
}

/// What the user typed on the sign-in screen.
enum SignInInput: Equatable {
    /// Handle (without `@`) or DID, normalised but otherwise as entered.
    case identity(String)
    /// A PDS or entryway origin; the server will ask which account to use.
    case server(URL)

    static func parse(_ raw: String, allowInsecureLocalhost: Bool) throws -> SignInInput {
        var text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.hasPrefix("@") { text.removeFirst() }
        guard !text.isEmpty else { throw ATProtoError.invalidIdentifier(raw) }

        if DID.isDIDString(text) {
            return .identity(try DID(text).rawValue)
        }
        let lowered = text.lowercased()
        if lowered.hasPrefix("https://") || lowered.hasPrefix("http://") {
            guard let url = URL(string: text), let origin = url.origin, let originURL = URL(string: origin) else {
                throw ATProtoError.invalidIdentifier(raw)
            }
            if url.scheme == "http", !(allowInsecureLocalhost && url.isLoopbackHost) {
                throw ATProtoError.invalidIdentifier(raw)
            }
            return .server(originURL)
        }
        if Handle.isValid(lowered) {
            return .identity(lowered)
        }
        // "localhost:3000" is unambiguous: no handle can end in a port.
        if allowInsecureLocalhost, lowered.hasPrefix("localhost"), let url = URL(string: "http://\(lowered)"),
           let origin = url.origin, let originURL = URL(string: origin) {
            return .server(originURL)
        }
        throw ATProtoError.invalidIdentifier(raw)
    }
}

/// Owns the signed-in session: starting and finishing the OAuth flow,
/// persisting tokens, refreshing them, signing out, and attaching DPoP proofs
/// to PDS requests. An actor so refresh/nonce bookkeeping cannot race.
public actor ATProtoSessionManager {
    public let client: OAuthClientConfiguration
    private let identityResolver: IdentityResolver
    private let discovery: OAuthServerDiscovery
    private let store: any SessionStore
    private let transport: any HTTPTransport
    private let http: HTTPClient
    private let keyFactory: any DPoPKeyFactory
    private let now: @Sendable () -> Date

    public private(set) var session: OAuthSession?
    /// Latest `DPoP-Nonce` per resource-server origin.
    private var resourceNonces: [String: String] = [:]
    private var authorizationServerNonce: String?
    private var refreshTask: Task<OAuthSession, Error>?

    public init(client: OAuthClientConfiguration,
                identity: IdentityResolverConfiguration,
                store: any SessionStore,
                transport: any HTTPTransport = URLSessionTransport(),
                keyFactory: any DPoPKeyFactory = P256DPoPKeyFactory(),
                now: @escaping @Sendable () -> Date = { Date() }) {
        self.client = client
        self.identityResolver = IdentityResolver(configuration: identity, transport: transport)
        self.discovery = OAuthServerDiscovery(client: client, transport: transport)
        self.store = store
        self.transport = transport
        self.http = HTTPClient(transport: transport)
        self.keyFactory = keyFactory
        self.now = now
    }

    // MARK: - Lifecycle

    /// Loads the persisted session and refreshes it if the access token is
    /// stale. Throws `sessionExpired` (session cleared) when the refresh token
    /// is rejected, or `serverUnavailable` (session kept) when the
    /// authorization server cannot be reached — the caller should keep the
    /// user signed in and retry later rather than force a new sign-in.
    @discardableResult
    public func restore() async throws -> OAuthSession? {
        guard let stored = try store.load() else {
            session = nil
            return nil
        }
        session = stored
        guard stored.needsRefresh(at: now()) else { return stored }
        return try await refreshSession()
    }

    /// Resolves the identifier, discovers its authorization server, and pushes
    /// the authorization request. Network-free until the first resolution.
    ///
    /// `redirectURI` overrides the client's configured redirect for this one
    /// flow; loopback development clients use it to pass the ephemeral port
    /// their listener happened to bind.
    public func beginSignIn(identifier rawIdentifier: String, redirectURI: String? = nil) async throws -> PendingAuthorization {
        let input = try SignInInput.parse(rawIdentifier, allowInsecureLocalhost: client.allowInsecureLocalhost)
        let redirectURI = redirectURI ?? client.redirectURI

        let expectedIdentity: ResolvedIdentity?
        let server: AuthorizationServerMetadata
        var parameters: [String: String] = [
            "response_type": "code",
            "redirect_uri": redirectURI,
            "scope": client.scope,
            "code_challenge_method": PKCE.codeChallengeMethod,
        ]
        switch input {
        case let .identity(identifier):
            let identity = try await identityResolver.resolveIdentity(identifier)
            expectedIdentity = identity
            server = try await discovery.authorizationServer(forPDS: identity.pdsURL)
            // The spec recommends hinting with what the user actually typed.
            parameters["login_hint"] = identifier
        case let .server(url):
            expectedIdentity = nil
            server = try await discovery.authorizationServer(forHost: url)
        }

        let key = keyFactory.makeKey()
        let pkce = PKCE.generate()
        let state = Data.random(count: 32).base64URLEncodedString()
        parameters["state"] = state
        parameters["code_challenge"] = pkce.codeChallenge

        let tokenClient = OAuthTokenClient(metadata: server, client: client, key: key, transport: transport)
        let pushed = try await tokenClient.pushAuthorizationRequest(parameters)
        let authorizationURL = server.authorizationEndpoint.appendingQueryItems([
            "client_id": client.clientID,
            "request_uri": pushed.requestURI,
        ])
        return PendingAuthorization(
            authorizationURL: authorizationURL,
            redirectURI: redirectURI,
            expectedIdentity: expectedIdentity,
            state: state,
            pkce: pkce,
            server: server,
            dpopKey: key.rawRepresentation,
            authorizationServerNonce: await tokenClient.currentNonce
        )
    }

    /// Validates the redirect, exchanges the code, verifies the account, and
    /// persists the resulting session.
    @discardableResult
    public func completeSignIn(callbackURL: URL, pending: PendingAuthorization) async throws -> OAuthSession {
        let params = callbackURL.queryParameters
        // State first: a redirect for some other flow must not be acted on,
        // whatever else it carries.
        guard params["state"] == pending.state else {
            throw ATProtoError.stateMismatch
        }
        if let error = params["error"] {
            throw ATProtoError.oauth(error: error, description: params["error_description"])
        }
        let expectedIssuer = pending.server.issuer.origin
        guard let iss = params["iss"], URL(string: iss)?.origin == expectedIssuer else {
            throw ATProtoError.issuerMismatch(expected: expectedIssuer ?? pending.server.issuer.absoluteString, received: params["iss"])
        }
        guard let code = params["code"], !code.isEmpty else {
            throw ATProtoError.invalidResponse("redirect is missing the authorization code")
        }

        let key = try keyFactory.key(from: pending.dpopKey)
        let tokenClient = OAuthTokenClient(
            metadata: pending.server, client: client, key: key,
            transport: transport, nonce: pending.authorizationServerNonce
        )
        let token = try await tokenClient.exchangeCode(code, codeVerifier: pending.pkce.codeVerifier, redirectURI: pending.redirectURI)
        authorizationServerNonce = await tokenClient.currentNonce

        let did = try DID(token.sub)
        let identity: ResolvedIdentity
        if let expected = pending.expectedIdentity {
            guard expected.did == did else {
                throw ATProtoError.accountMismatch(expected: expected.did.rawValue, received: did.rawValue)
            }
            identity = expected
        } else {
            // Server-first flow: the token says who signed in, so confirm that
            // account's PDS really is served by the issuer we talked to.
            identity = try await identityResolver.resolveIdentity(did: did)
            let actual = try await discovery.authorizationServer(forPDS: identity.pdsURL)
            guard actual.issuer.origin == expectedIssuer else {
                throw ATProtoError.issuerMismatch(expected: pending.server.issuer.absoluteString, received: actual.issuer.absoluteString)
            }
        }

        var newSession = OAuthSession(
            identity: identity,
            authorizationServer: pending.server,
            accessToken: token.accessToken,
            refreshToken: token.refreshToken,
            expiresAt: nil,
            scope: token.scope ?? client.scope,
            dpopKey: pending.dpopKey,
            createdAt: now()
        )
        newSession.apply(token, at: now())
        try store.save(newSession)
        session = newSession
        return newSession
    }

    /// Clears the local session first, then revokes the tokens best-effort. An
    /// unreachable server must never leave a user unable to sign out.
    public func signOut() async {
        refreshTask?.cancel()
        refreshTask = nil
        let current = session
        session = nil
        resourceNonces = [:]
        try? store.clear()
        guard let current, let key = try? keyFactory.key(from: current.dpopKey) else { return }
        let tokenClient = OAuthTokenClient(
            metadata: current.authorizationServer, client: client, key: key,
            transport: transport, nonce: authorizationServerNonce
        )
        try? await tokenClient.revoke(token: current.refreshToken ?? current.accessToken)
        authorizationServerNonce = nil
    }

    /// Re-reads the account's DID document so handle changes and PDS moves show
    /// up, and stores the result.
    public func refreshIdentity() async throws -> ResolvedIdentity {
        guard var current = session else { throw ATProtoError.notSignedIn }
        let identity = try await identityResolver.resolveIdentity(did: current.did)
        guard session != nil else { throw ATProtoError.notSignedIn }
        current.identity = identity
        try store.save(current)
        session = current
        return identity
    }

    // MARK: - Authenticated requests

    /// Sends `request` with the session's DPoP-bound access token, refreshing
    /// first if it is about to expire. Handles the two retry cases the spec
    /// requires: a nonce rotation (`use_dpop_nonce`) and a token the server
    /// rejects early (401), each retried once.
    public func authorizedSend(_ request: URLRequest) async throws -> HTTPResponse {
        guard var current = session else { throw ATProtoError.notSignedIn }
        if current.needsRefresh(at: now()) {
            current = try await refreshSession()
        }
        var response = try await sendWithProof(request, session: current)
        if DPoPResponse.requiresNewNonce(response) {
            response = try await sendWithProof(request, session: current)
        }
        guard response.statusCode == 401 else { return response }

        let refreshed = try await refreshSession()
        response = try await sendWithProof(request, session: refreshed)
        if DPoPResponse.requiresNewNonce(response) {
            response = try await sendWithProof(request, session: refreshed)
        }
        if response.statusCode == 401 {
            invalidateSession()
            throw ATProtoError.sessionExpired
        }
        return response
    }

    public func query<Output: Decodable>(_ nsid: String, parameters: [String: String] = [:], as type: Output.Type) async throws -> Output {
        guard let session else { throw ATProtoError.notSignedIn }
        let response = try await authorizedSend(XRPC.queryRequest(service: session.pdsURL, nsid: nsid, parameters: parameters))
        return try XRPC.decode(response, as: type)
    }

    public func procedure<Input: Encodable, Output: Decodable>(_ nsid: String, input: Input?, as type: Output.Type) async throws -> Output {
        guard let session else { throw ATProtoError.notSignedIn }
        let request = try XRPC.procedureRequest(service: session.pdsURL, nsid: nsid, input: input)
        return try XRPC.decode(try await authorizedSend(request), as: type)
    }

    // MARK: - Private

    private func sendWithProof(_ request: URLRequest, session: OAuthSession) async throws -> HTTPResponse {
        guard let url = request.url else { throw ATProtoError.invalidResponse("request has no URL") }
        let originKey = url.origin ?? url.absoluteString
        let proofs = DPoPProofGenerator(key: try keyFactory.key(from: session.dpopKey))
        var request = request
        request.setValue("DPoP \(session.accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue(
            try proofs.proof(
                method: request.httpMethod ?? "GET", url: url,
                nonce: resourceNonces[originKey], accessToken: session.accessToken, issuedAt: now()
            ),
            forHTTPHeaderField: "DPoP"
        )
        let response = try await http.send(request)
        if let nonce = DPoPResponse.nonce(response) {
            resourceNonces[originKey] = nonce
        }
        return response
    }

    /// Coalesces concurrent callers onto one refresh so a single-use refresh
    /// token is never presented twice.
    private func refreshSession() async throws -> OAuthSession {
        if let inFlight = refreshTask {
            return try await inFlight.value
        }
        let task = Task { try await performRefresh() }
        refreshTask = task
        defer { if refreshTask == task { refreshTask = nil } }
        return try await task.value
    }

    private func performRefresh() async throws -> OAuthSession {
        guard let current = session else { throw ATProtoError.notSignedIn }
        guard let refreshToken = current.refreshToken else {
            invalidateSession()
            throw ATProtoError.sessionExpired
        }
        let tokenClient = OAuthTokenClient(
            metadata: current.authorizationServer, client: client,
            key: try keyFactory.key(from: current.dpopKey),
            transport: transport, nonce: authorizationServerNonce
        )
        let token: OAuthTokenResponse
        do {
            token = try await tokenClient.refresh(refreshToken: refreshToken)
        } catch ATProtoError.sessionExpired {
            invalidateSession()
            throw ATProtoError.sessionExpired
        }
        authorizationServerNonce = await tokenClient.currentNonce

        // The user may have signed out while the request was in flight.
        guard var updated = session else { throw ATProtoError.notSignedIn }
        guard token.sub == updated.did.rawValue else {
            invalidateSession()
            throw ATProtoError.accountMismatch(expected: updated.did.rawValue, received: token.sub)
        }
        updated.apply(token, at: now())
        try store.save(updated)
        session = updated
        return updated
    }

    private func invalidateSession() {
        session = nil
        resourceNonces = [:]
        try? store.clear()
    }
}
