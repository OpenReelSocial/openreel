import XCTest
@testable import OpenReelATProto

final class SignInInputTests: XCTestCase {
    func testParsesHandlesDIDsAndServers() throws {
        XCTAssertEqual(try SignInInput.parse(" @Alice.Example.com ", allowInsecureLocalhost: false), .identity("alice.example.com"))
        XCTAssertEqual(try SignInInput.parse("did:plc:abc", allowInsecureLocalhost: false), .identity("did:plc:abc"))
        XCTAssertEqual(try SignInInput.parse("https://pds.example.com/some/path", allowInsecureLocalhost: false),
                       .server(URL(string: "https://pds.example.com")!))
    }

    func testPlainHTTPServersOnlyWhenLocalhostAllowed() throws {
        XCTAssertThrowsError(try SignInInput.parse("http://pds.example.com", allowInsecureLocalhost: true))
        XCTAssertThrowsError(try SignInInput.parse("http://localhost:3000", allowInsecureLocalhost: false))
        XCTAssertThrowsError(try SignInInput.parse("localhost:3000", allowInsecureLocalhost: false))
        XCTAssertEqual(try SignInInput.parse("http://localhost:3000", allowInsecureLocalhost: true), .server(URL(string: "http://localhost:3000")!))
        XCTAssertEqual(try SignInInput.parse("localhost:3000", allowInsecureLocalhost: true), .server(URL(string: "http://localhost:3000")!))
    }

    func testRejectsGarbage() {
        for bad in ["", "@", "alice", "not a handle", "did:key:zzz"] {
            XCTAssertThrowsError(try SignInInput.parse(bad, allowInsecureLocalhost: false), bad)
        }
    }
}

final class SessionManagerTests: XCTestCase {
    private var transport: StubTransport!
    private var store: InMemorySessionStore!
    private var clock: Clock!
    private var manager: ATProtoSessionManager!

    private let tokenURL = Fixtures.authServer.tokenEndpoint.absoluteString
    private let parURL = Fixtures.authServer.pushedAuthorizationRequestEndpoint.absoluteString
    private let revokeURL = Fixtures.authServer.revocationEndpoint!.absoluteString
    private let sessionURL = Fixtures.pds.appending(path: "xrpc/com.atproto.server.getSession").absoluteString

    final class Clock: @unchecked Sendable {
        private let lock = NSLock()
        private var _now = Date(timeIntervalSince1970: 1_700_000_000)
        var now: Date {
            get { lock.withLock { _now } }
            set { lock.withLock { _now = newValue } }
        }
    }

    override func setUp() {
        transport = StubTransport()
        store = InMemorySessionStore()
        clock = Clock()
        manager = makeManager()
    }

    private func makeManager(store: InMemorySessionStore? = nil) -> ATProtoSessionManager {
        let clock = self.clock!
        return ATProtoSessionManager(
            client: Fixtures.client,
            identity: IdentityResolverConfiguration(plcDirectoryURL: Fixtures.plc, handleResolverURL: Fixtures.pds),
            store: store ?? self.store,
            transport: transport,
            keyFactory: FakeDPoPKeyFactory(),
            now: { clock.now }
        )
    }

    private func stubPAR() {
        transport.json("POST", parURL, status: 201, ["request_uri": "urn:ietf:params:oauth:request_uri:req-1", "expires_in": 60])
    }

    private func callback(state: String, code: String = "code-1", iss: String = Fixtures.pds.absoluteString, extra: [String: String] = [:]) -> URL {
        var items = ["state": state, "code": code, "iss": iss]
        for (key, value) in extra { items[key] = value }
        return URL(string: Fixtures.client.redirectURI)!.appendingQueryItems(items)
    }

    // MARK: - Sign in

    func testBeginSignInPushesRequestAndBuildsAuthorizationURL() async throws {
        Fixtures.stubIdentityAndDiscovery(transport)
        stubPAR()

        let pending = try await manager.beginSignIn(identifier: "@alice.example.com")

        let par = try XCTUnwrap(transport.requests(matching: parURL).last).formBody
        XCTAssertEqual(par["client_id"], Fixtures.client.clientID)
        XCTAssertEqual(par["redirect_uri"], Fixtures.client.redirectURI)
        XCTAssertEqual(par["response_type"], "code")
        XCTAssertEqual(par["scope"], "atproto transition:generic")
        XCTAssertEqual(par["login_hint"], "alice.example.com")
        XCTAssertEqual(par["code_challenge_method"], "S256")
        XCTAssertEqual(par["code_challenge"], pending.pkce.codeChallenge)
        XCTAssertEqual(par["state"], pending.state)
        XCTAssertFalse(pending.state.isEmpty)

        let query = pending.authorizationURL.queryParameters
        XCTAssertTrue(pending.authorizationURL.absoluteString.hasPrefix(Fixtures.authServer.authorizationEndpoint.absoluteString + "?"))
        XCTAssertEqual(query["client_id"], Fixtures.client.clientID)
        XCTAssertEqual(query["request_uri"], "urn:ietf:params:oauth:request_uri:req-1")
        XCTAssertEqual(pending.expectedIdentity?.did, Fixtures.did)
    }

    func testBeginSignInCanOverrideRedirectForLoopbackPort() async throws {
        Fixtures.stubIdentityAndDiscovery(transport)
        stubPAR()
        transport.json("POST", tokenURL, Fixtures.tokenJSON())

        let pending = try await manager.beginSignIn(identifier: "alice.example.com", redirectURI: "http://127.0.0.1:49152/oauth/callback")
        XCTAssertEqual(pending.redirectURI, "http://127.0.0.1:49152/oauth/callback")
        XCTAssertEqual(transport.requests(matching: parURL).last?.formBody["redirect_uri"], "http://127.0.0.1:49152/oauth/callback")

        _ = try await manager.completeSignIn(callbackURL: callback(state: pending.state), pending: pending)
        XCTAssertEqual(transport.requests(matching: tokenURL).last?.formBody["redirect_uri"], "http://127.0.0.1:49152/oauth/callback")
    }

    func testBeginSignInSurfacesUnavailablePDS() async {
        transport.unavailable("GET", "https://alice.example.com")
        transport.unavailable("GET", Fixtures.pds.absoluteString)

        do {
            _ = try await manager.beginSignIn(identifier: "alice.example.com")
            XCTFail("expected serverUnavailable")
        } catch {
            XCTAssertEqual(error as? ATProtoError, .serverUnavailable(.unreachable(host: "pds.example.com")))
        }
    }

    func testCompleteSignInExchangesCodeAndPersists() async throws {
        Fixtures.stubIdentityAndDiscovery(transport)
        stubPAR()
        transport.json("POST", tokenURL, headers: ["DPoP-Nonce": "as-nonce"], Fixtures.tokenJSON())
        let pending = try await manager.beginSignIn(identifier: "alice.example.com")

        let session = try await manager.completeSignIn(callbackURL: callback(state: pending.state), pending: pending)

        let exchange = try XCTUnwrap(transport.requests(matching: tokenURL).last)
        XCTAssertEqual(exchange.formBody["code"], "code-1")
        XCTAssertEqual(exchange.formBody["code_verifier"], pending.pkce.codeVerifier)
        XCTAssertEqual(exchange.formBody["redirect_uri"], Fixtures.client.redirectURI)
        XCTAssertEqual(decodeProof(exchange.value(forHTTPHeaderField: "DPoP")!).payload["htu"] as? String, tokenURL)

        XCTAssertEqual(session.did, Fixtures.did)
        XCTAssertEqual(session.handle, Fixtures.handle)
        XCTAssertEqual(session.accessToken, "access-1")
        XCTAssertEqual(session.refreshToken, "refresh-1")
        XCTAssertEqual(session.expiresAt, clock.now.addingTimeInterval(300))
        XCTAssertEqual(session.dpopKey, Data([1, 2, 3, 4]))
        XCTAssertEqual(try store.load(), session)
        let live = await manager.session
        XCTAssertEqual(live, session)
    }

    func testCompleteSignInRejectsWrongState() async throws {
        Fixtures.stubIdentityAndDiscovery(transport)
        stubPAR()
        let pending = try await manager.beginSignIn(identifier: "alice.example.com")

        do {
            _ = try await manager.completeSignIn(callbackURL: callback(state: "someone-elses"), pending: pending)
            XCTFail("expected stateMismatch")
        } catch {
            XCTAssertEqual(error as? ATProtoError, .stateMismatch)
        }
        XCTAssertTrue(transport.requests(matching: tokenURL).isEmpty, "must not exchange the code")
        XCTAssertNil(try store.load())
    }

    func testCompleteSignInSurfacesDeniedAuthorization() async throws {
        Fixtures.stubIdentityAndDiscovery(transport)
        stubPAR()
        let pending = try await manager.beginSignIn(identifier: "alice.example.com")
        let url = URL(string: Fixtures.client.redirectURI)!.appendingQueryItems([
            "state": pending.state, "error": "access_denied", "error_description": "user said no",
        ])

        do {
            _ = try await manager.completeSignIn(callbackURL: url, pending: pending)
            XCTFail("expected oauth error")
        } catch {
            XCTAssertEqual(error as? ATProtoError, .oauth(error: "access_denied", description: "user said no"))
        }
    }

    func testCompleteSignInRejectsWrongIssuer() async throws {
        Fixtures.stubIdentityAndDiscovery(transport)
        stubPAR()
        let pending = try await manager.beginSignIn(identifier: "alice.example.com")

        do {
            _ = try await manager.completeSignIn(callbackURL: callback(state: pending.state, iss: "https://evil.example.com"), pending: pending)
            XCTFail("expected issuerMismatch")
        } catch {
            XCTAssertEqual(error as? ATProtoError, .issuerMismatch(expected: Fixtures.pds.absoluteString, received: "https://evil.example.com"))
        }
        XCTAssertTrue(transport.requests(matching: tokenURL).isEmpty)
    }

    func testCompleteSignInRejectsTokenForDifferentAccount() async throws {
        Fixtures.stubIdentityAndDiscovery(transport)
        stubPAR()
        transport.json("POST", tokenURL, Fixtures.tokenJSON(sub: "did:plc:mallory"))
        let pending = try await manager.beginSignIn(identifier: "alice.example.com")

        do {
            _ = try await manager.completeSignIn(callbackURL: callback(state: pending.state), pending: pending)
            XCTFail("expected accountMismatch")
        } catch {
            XCTAssertEqual(error as? ATProtoError, .accountMismatch(expected: Fixtures.did.rawValue, received: "did:plc:mallory"))
        }
        XCTAssertNil(try store.load())
    }

    func testServerFirstSignInResolvesAccountFromToken() async throws {
        Fixtures.stubIdentityAndDiscovery(transport)
        stubPAR()
        transport.json("POST", tokenURL, Fixtures.tokenJSON())

        let pending = try await manager.beginSignIn(identifier: "https://pds.example.com")
        XCTAssertNil(pending.expectedIdentity)
        XCTAssertNil(transport.requests(matching: parURL).last?.formBody["login_hint"])

        let session = try await manager.completeSignIn(callbackURL: callback(state: pending.state), pending: pending)

        XCTAssertEqual(session.did, Fixtures.did)
        XCTAssertEqual(session.handle, Fixtures.handle)
        XCTAssertEqual(session.pdsURL, Fixtures.pds)
    }

    // MARK: - Restore

    func testRestoreReturnsFreshSessionWithoutNetwork() async throws {
        try store.save(Fixtures.session(expiresAt: clock.now.addingTimeInterval(600)))

        let restored = try await manager.restore()

        XCTAssertEqual(restored?.accessToken, "access-0")
        XCTAssertTrue(transport.requests.isEmpty)
    }

    func testRestoreRefreshesStaleToken() async throws {
        try store.save(Fixtures.session(expiresAt: clock.now.addingTimeInterval(10)))
        transport.json("POST", tokenURL, Fixtures.tokenJSON(access: "access-2", refresh: "refresh-2"))

        let restored = try await manager.restore()

        let body = try XCTUnwrap(transport.requests(matching: tokenURL).last).formBody
        XCTAssertEqual(body["grant_type"], "refresh_token")
        XCTAssertEqual(body["refresh_token"], "refresh-0")
        XCTAssertEqual(restored?.accessToken, "access-2")
        XCTAssertEqual(restored?.refreshToken, "refresh-2")
        XCTAssertEqual(try store.load()?.accessToken, "access-2")
    }

    func testRestoreKeepsSessionWhenServerIsUnavailable() async throws {
        try store.save(Fixtures.session(expiresAt: clock.now))
        transport.unavailable("POST", tokenURL)

        do {
            try await manager.restore()
            XCTFail("expected serverUnavailable")
        } catch {
            XCTAssertEqual(error as? ATProtoError, .serverUnavailable(.unreachable(host: "pds.example.com")))
        }
        XCTAssertNotNil(try store.load(), "an outage is not a sign-out")
        let live = await manager.session
        XCTAssertNotNil(live)
    }

    func testRestoreClearsSessionWhenRefreshTokenIsRejected() async throws {
        try store.save(Fixtures.session(expiresAt: clock.now))
        transport.json("POST", tokenURL, status: 400, ["error": "invalid_grant"])

        do {
            try await manager.restore()
            XCTFail("expected sessionExpired")
        } catch {
            XCTAssertEqual(error as? ATProtoError, .sessionExpired)
        }
        XCTAssertNil(try store.load())
        let live = await manager.session
        XCTAssertNil(live)
    }

    func testRestoreWithoutRefreshTokenExpiresInsteadOfCalling() async throws {
        try store.save(Fixtures.session(refreshToken: nil, expiresAt: clock.now))

        do {
            try await manager.restore()
            XCTFail("expected sessionExpired")
        } catch {
            XCTAssertEqual(error as? ATProtoError, .sessionExpired)
        }
        XCTAssertTrue(transport.requests.isEmpty)
        XCTAssertNil(try store.load())
    }

    // MARK: - Authorised requests

    func testAuthorizedSendAttachesDPoPBoundToken() async throws {
        try store.save(Fixtures.session(expiresAt: clock.now.addingTimeInterval(600)))
        try await manager.restore()
        transport.json("GET", sessionURL, headers: ["DPoP-Nonce": "pds-nonce"], ["did": Fixtures.did.rawValue])

        let response = try await manager.authorizedSend(XRPC.queryRequest(service: Fixtures.pds, nsid: "com.atproto.server.getSession", parameters: [:]))
        XCTAssertEqual(response.statusCode, 200)

        let sent = try XCTUnwrap(transport.requests(matching: sessionURL).last)
        XCTAssertEqual(sent.value(forHTTPHeaderField: "Authorization"), "DPoP access-0")
        let proof = decodeProof(try XCTUnwrap(sent.value(forHTTPHeaderField: "DPoP")))
        XCTAssertEqual(proof.payload["htm"] as? String, "GET")
        XCTAssertEqual(proof.payload["htu"] as? String, sessionURL)
        XCTAssertEqual(proof.payload["ath"] as? String, SHA256Digest.base64URL(of: "access-0"))
        XCTAssertNil(proof.payload["nonce"])

        // The nonce the PDS handed back is used on the next call to that origin.
        _ = try await manager.authorizedSend(XRPC.queryRequest(service: Fixtures.pds, nsid: "com.atproto.server.getSession", parameters: [:]))
        let second = try XCTUnwrap(transport.requests(matching: sessionURL).last)
        XCTAssertEqual(decodeProof(second.value(forHTTPHeaderField: "DPoP")!).payload["nonce"] as? String, "pds-nonce")
    }

    func testAuthorizedSendRetriesWhenPDSDemandsNonce() async throws {
        try store.save(Fixtures.session(expiresAt: clock.now.addingTimeInterval(600)))
        try await manager.restore()
        transport.on("GET", sessionURL) { request in
            let proof = decodeProof(request.value(forHTTPHeaderField: "DPoP") ?? "")
            guard proof.payload["nonce"] as? String == "fresh" else {
                return HTTPResponse(statusCode: 401,
                                    headers: ["DPoP-Nonce": "fresh", "WWW-Authenticate": #"DPoP error="use_dpop_nonce""#])
            }
            return HTTPResponse(statusCode: 200, body: Data("{}".utf8))
        }

        let response = try await manager.authorizedSend(XRPC.queryRequest(service: Fixtures.pds, nsid: "com.atproto.server.getSession", parameters: [:]))

        XCTAssertEqual(response.statusCode, 200)
        XCTAssertEqual(transport.requests(matching: sessionURL).count, 2)
        XCTAssertTrue(transport.requests(matching: tokenURL).isEmpty, "a nonce rotation is not a token problem")
    }

    func testAuthorizedSendRefreshesOnRejectedTokenThenRetries() async throws {
        try store.save(Fixtures.session(expiresAt: clock.now.addingTimeInterval(600)))
        try await manager.restore()
        transport.json("POST", tokenURL, Fixtures.tokenJSON(access: "access-2", refresh: "refresh-2"))
        transport.on("GET", sessionURL) { request in
            if request.value(forHTTPHeaderField: "Authorization") == "DPoP access-2" {
                return HTTPResponse(statusCode: 200, body: Data("{}".utf8))
            }
            return HTTPResponse(statusCode: 401, headers: ["WWW-Authenticate": #"DPoP error="invalid_token""#])
        }

        let response = try await manager.authorizedSend(XRPC.queryRequest(service: Fixtures.pds, nsid: "com.atproto.server.getSession", parameters: [:]))

        XCTAssertEqual(response.statusCode, 200)
        XCTAssertEqual(transport.requests(matching: tokenURL).count, 1)
        XCTAssertEqual(try store.load()?.accessToken, "access-2")
    }

    func testAuthorizedSendGivesUpWhenRefreshedTokenIsStillRejected() async throws {
        try store.save(Fixtures.session(expiresAt: clock.now.addingTimeInterval(600)))
        try await manager.restore()
        transport.json("POST", tokenURL, Fixtures.tokenJSON(access: "access-2"))
        transport.on("GET", sessionURL) { _ in HTTPResponse(statusCode: 401) }

        do {
            _ = try await manager.authorizedSend(XRPC.queryRequest(service: Fixtures.pds, nsid: "com.atproto.server.getSession", parameters: [:]))
            XCTFail("expected sessionExpired")
        } catch {
            XCTAssertEqual(error as? ATProtoError, .sessionExpired)
        }
        XCTAssertNil(try store.load())
        let live = await manager.session
        XCTAssertNil(live)
    }

    func testAuthorizedSendRefreshesProactivelyWhenTokenIsAboutToExpire() async throws {
        try store.save(Fixtures.session(expiresAt: clock.now.addingTimeInterval(600)))
        try await manager.restore()
        transport.json("POST", tokenURL, Fixtures.tokenJSON(access: "access-2"))
        transport.json("GET", sessionURL, ["did": Fixtures.did.rawValue])
        clock.now = clock.now.addingTimeInterval(590)

        _ = try await manager.authorizedSend(XRPC.queryRequest(service: Fixtures.pds, nsid: "com.atproto.server.getSession", parameters: [:]))

        XCTAssertEqual(transport.requests(matching: tokenURL).count, 1)
        XCTAssertEqual(transport.requests(matching: sessionURL).last?.value(forHTTPHeaderField: "Authorization"), "DPoP access-2")
    }

    func testConcurrentCallersShareOneRefresh() async throws {
        try store.save(Fixtures.session(expiresAt: clock.now.addingTimeInterval(600)))
        try await manager.restore()
        transport.json("POST", tokenURL, Fixtures.tokenJSON(access: "access-2"))
        transport.json("GET", sessionURL, ["did": Fixtures.did.rawValue])
        // Token is now stale, so both callers will want a refresh.
        clock.now = clock.now.addingTimeInterval(600)
        let request = XRPC.queryRequest(service: Fixtures.pds, nsid: "com.atproto.server.getSession", parameters: [:])

        let manager = self.manager!
        async let first = manager.authorizedSend(request)
        async let second = manager.authorizedSend(request)
        _ = try await (first, second)

        XCTAssertEqual(transport.requests(matching: tokenURL).count, 1, "a single-use refresh token must only be presented once")
    }

    func testRequestsWithoutSessionFail() async {
        do {
            _ = try await manager.authorizedSend(URLRequest(url: Fixtures.pds))
            XCTFail("expected notSignedIn")
        } catch {
            XCTAssertEqual(error as? ATProtoError, .notSignedIn)
        }
    }

    // MARK: - Sign out

    func testSignOutClearsStoreAndRevokesRefreshToken() async throws {
        try store.save(Fixtures.session(expiresAt: clock.now.addingTimeInterval(600)))
        try await manager.restore()
        transport.json("POST", revokeURL, [String: Any]())

        await manager.signOut()

        XCTAssertNil(try store.load())
        let live = await manager.session
        XCTAssertNil(live)
        let revoke = try XCTUnwrap(transport.requests(matching: revokeURL).last)
        XCTAssertEqual(revoke.formBody["token"], "refresh-0")
        XCTAssertEqual(revoke.formBody["client_id"], Fixtures.client.clientID)
    }

    func testSignOutSucceedsLocallyWhenServerIsUnavailable() async throws {
        try store.save(Fixtures.session(expiresAt: clock.now.addingTimeInterval(600)))
        try await manager.restore()
        transport.unavailable("POST", revokeURL)

        await manager.signOut()

        XCTAssertNil(try store.load())
        let live = await manager.session
        XCTAssertNil(live)
        do {
            _ = try await manager.authorizedSend(URLRequest(url: Fixtures.pds))
            XCTFail("expected notSignedIn")
        } catch {
            XCTAssertEqual(error as? ATProtoError, .notSignedIn)
        }
    }

    // MARK: - Identity refresh

    func testRefreshIdentityDropsHandleThatNoLongerVerifies() async throws {
        try store.save(Fixtures.session(expiresAt: clock.now.addingTimeInterval(600)))
        try await manager.restore()
        Fixtures.stubIdentityAndDiscovery(transport)
        var document = Fixtures.didDocumentJSON
        document["alsoKnownAs"] = ["at://renamed.example.com"]
        transport.json("GET", Fixtures.plc.appending(path: Fixtures.did.rawValue).absoluteString, document)
        transport.unavailable("GET", "https://renamed.example.com")
        transport.json("GET", Fixtures.pds.appending(path: "xrpc/com.atproto.identity.resolveHandle").absoluteString, ["did": "did:plc:someoneelse"])

        let identity = try await manager.refreshIdentity()

        XCTAssertNil(identity.handle)
        XCTAssertEqual(try store.load()?.handle, nil)
    }
}
