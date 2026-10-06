import XCTest
@testable import OpenReelATProto

final class PKCETests: XCTestCase {
    func testKnownVectorFromRFC7636() {
        // RFC 7636 Appendix B.
        let pkce = PKCE(codeVerifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")
        XCTAssertEqual(pkce.codeChallenge, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
    }

    func testGeneratedVerifierIsWithinSpecLength() {
        let pkce = PKCE.generate()
        XCTAssertTrue((43...128).contains(pkce.codeVerifier.count))
        XCTAssertNotEqual(pkce.codeVerifier, PKCE.generate().codeVerifier)
    }
}

final class Base64URLTests: XCTestCase {
    func testRoundTripWithoutPadding() {
        let data = Data([0xfb, 0xff, 0x00, 0x01])
        let encoded = data.base64URLEncodedString()
        XCTAssertFalse(encoded.contains("="))
        XCTAssertFalse(encoded.contains("+") || encoded.contains("/"))
        XCTAssertEqual(Data(base64URLEncoded: encoded), data)
    }
}

final class DPoPProofTests: XCTestCase {
    private let generator = DPoPProofGenerator(key: FakeDPoPKey(rawRepresentation: Data([1, 2, 3, 4])))

    func testTokenEndpointProofShape() throws {
        let url = URL(string: "https://pds.example.com/oauth/token?ignored=1#frag")!
        let proof = try generator.proof(method: "post", url: url, nonce: "n-1", issuedAt: Date(timeIntervalSince1970: 1_700_000_000), jti: "jti-1")
        let (header, payload) = decodeProof(proof)

        XCTAssertEqual(header["typ"] as? String, "dpop+jwt")
        XCTAssertEqual(header["alg"] as? String, "ES256")
        XCTAssertEqual(header["jwk"] as? [String: String], ["kty": "EC", "crv": "P-256", "x": "fake-x", "y": "fake-y"])
        XCTAssertEqual(payload["htm"] as? String, "POST")
        XCTAssertEqual(payload["htu"] as? String, "https://pds.example.com/oauth/token", "query and fragment are stripped")
        XCTAssertEqual(payload["iat"] as? Int, 1_700_000_000)
        XCTAssertEqual(payload["jti"] as? String, "jti-1")
        XCTAssertEqual(payload["nonce"] as? String, "n-1")
        XCTAssertNil(payload["ath"])
        XCTAssertEqual(proof.split(separator: ".").count, 3)
    }

    func testResourceProofBindsAccessToken() throws {
        let proof = try generator.proof(method: "GET", url: Fixtures.pds, nonce: nil, accessToken: "token-abc")
        let (_, payload) = decodeProof(proof)
        XCTAssertEqual(payload["ath"] as? String, SHA256Digest.base64URL(of: "token-abc"))
        XCTAssertNil(payload["nonce"])
    }

    func testP256KeyRoundTripsAndProducesRawSignature() throws {
        let key = P256DPoPKey()
        let restored = try P256DPoPKey(rawRepresentation: key.rawRepresentation)
        XCTAssertEqual(restored.publicJWK, key.publicJWK)
        XCTAssertEqual(key.publicJWK["kty"], "EC")
        XCTAssertEqual(key.publicJWK["crv"], "P-256")
        XCTAssertEqual(Data(base64URLEncoded: key.publicJWK["x"]!)?.count, 32)
        XCTAssertEqual(try key.sign(Data("hello".utf8)).count, 64, "ES256 wants raw r||s, not DER")
    }
}

final class ServerMetadataTests: XCTestCase {
    func testDecodesAndValidates() throws {
        let data = try JSONSerialization.data(withJSONObject: Fixtures.authServerJSON)
        let metadata = try JSONDecoder().decode(AuthorizationServerMetadata.self, from: data)
        XCTAssertNoThrow(try metadata.validate(fetchedFrom: "https://pds.example.com", client: Fixtures.client))
        XCTAssertEqual(metadata.revocationEndpoint?.absoluteString, "https://pds.example.com/oauth/revoke")
    }

    func testRejectsIssuerThatDoesNotMatchOrigin() throws {
        var json = Fixtures.authServerJSON
        json["issuer"] = "https://evil.example.com"
        let metadata = try JSONDecoder().decode(AuthorizationServerMetadata.self, from: JSONSerialization.data(withJSONObject: json))
        XCTAssertThrowsError(try metadata.validate(fetchedFrom: "https://pds.example.com", client: Fixtures.client))
    }

    func testRejectsPlainHTTPUnlessLocalhostIsAllowed() throws {
        var json = Fixtures.authServerJSON
        json["issuer"] = "http://localhost:3000"
        let metadata = try JSONDecoder().decode(AuthorizationServerMetadata.self, from: JSONSerialization.data(withJSONObject: json))
        XCTAssertThrowsError(try metadata.validate(fetchedFrom: "http://localhost:3000", client: Fixtures.client))
        let loopback = OAuthClientConfiguration.loopback(redirectURI: URL(string: "http://127.0.0.1:49152/oauth/callback")!)
        XCTAssertNoThrow(try metadata.validate(fetchedFrom: "http://localhost:3000", client: loopback))
    }

    func testRejectsServersWithoutES256OrS256() throws {
        var json = Fixtures.authServerJSON
        json["dpop_signing_alg_values_supported"] = ["RS256"]
        var metadata = try JSONDecoder().decode(AuthorizationServerMetadata.self, from: JSONSerialization.data(withJSONObject: json))
        XCTAssertThrowsError(try metadata.validate(fetchedFrom: "https://pds.example.com", client: Fixtures.client))

        json = Fixtures.authServerJSON
        json["code_challenge_methods_supported"] = ["plain"]
        metadata = try JSONDecoder().decode(AuthorizationServerMetadata.self, from: JSONSerialization.data(withJSONObject: json))
        XCTAssertThrowsError(try metadata.validate(fetchedFrom: "https://pds.example.com", client: Fixtures.client))
    }

    func testDiscoveryFollowsProtectedResourceToAuthorizationServer() async throws {
        let transport = StubTransport()
        let entryway = URL(string: "https://entryway.example.com")!
        transport.json("GET", Fixtures.pds.appending(path: ".well-known/oauth-protected-resource").absoluteString,
                       ["resource": Fixtures.pds.absoluteString, "authorization_servers": [entryway.absoluteString]])
        var json = Fixtures.authServerJSON
        json["issuer"] = entryway.absoluteString
        transport.json("GET", entryway.appending(path: ".well-known/oauth-authorization-server").absoluteString, json)

        let discovery = OAuthServerDiscovery(client: Fixtures.client, transport: transport)
        let metadata = try await discovery.authorizationServer(forPDS: Fixtures.pds)

        XCTAssertEqual(metadata.issuer, entryway)
    }

    func testDiscoveryFailsWhenPDSIsDown() async {
        let transport = StubTransport()
        transport.unavailable("GET", Fixtures.pds.absoluteString)
        let discovery = OAuthServerDiscovery(client: Fixtures.client, transport: transport)

        do {
            _ = try await discovery.authorizationServer(forPDS: Fixtures.pds)
            XCTFail("expected serverUnavailable")
        } catch {
            XCTAssertEqual(error as? ATProtoError, .serverUnavailable(.unreachable(host: "pds.example.com")))
        }
    }
}

final class LoopbackClientConfigurationTests: XCTestCase {
    func testLoopbackClientIDCarriesRedirectAndScope() throws {
        let config = OAuthClientConfiguration.loopback(redirectURI: URL(string: "http://127.0.0.1:49152/oauth/callback")!)
        XCTAssertTrue(config.isLoopbackClient)
        XCTAssertTrue(config.allowInsecureLocalhost)
        XCTAssertEqual(config.redirectURI, "http://127.0.0.1:49152/oauth/callback")

        let components = try XCTUnwrap(URLComponents(string: config.clientID))
        XCTAssertEqual(components.host, "localhost")
        let items = Dictionary(uniqueKeysWithValues: (components.queryItems ?? []).map { ($0.name, $0.value ?? "") })
        XCTAssertEqual(items["redirect_uri"], "http://127.0.0.1/oauth/callback", "port is dropped from the declared URI")
        XCTAssertEqual(items["scope"], OAuthClientConfiguration.defaultScope)
    }
}

final class OAuthTokenClientTests: XCTestCase {
    private func makeClient(_ transport: StubTransport) -> OAuthTokenClient {
        OAuthTokenClient(metadata: Fixtures.authServer, client: Fixtures.client,
                         key: FakeDPoPKey(rawRepresentation: Data([1, 2, 3, 4])), transport: transport)
    }

    func testRetriesOnceWithServerNonce() async throws {
        let transport = StubTransport()
        let tokenURL = Fixtures.authServer.tokenEndpoint.absoluteString
        transport.on("POST", tokenURL) { request in
            let proof = decodeProof(request.value(forHTTPHeaderField: "DPoP") ?? "")
            if proof.payload["nonce"] == nil {
                return HTTPResponse(statusCode: 400, headers: ["DPoP-Nonce": "server-nonce"],
                                    body: try JSONSerialization.data(withJSONObject: ["error": "use_dpop_nonce"]))
            }
            XCTAssertEqual(proof.payload["nonce"] as? String, "server-nonce")
            return HTTPResponse(statusCode: 200, headers: ["DPoP-Nonce": "server-nonce-2"],
                                body: try JSONSerialization.data(withJSONObject: Fixtures.tokenJSON()))
        }

        let client = makeClient(transport)
        let token = try await client.exchangeCode("code", codeVerifier: "verifier", redirectURI: Fixtures.client.redirectURI)

        XCTAssertEqual(token.accessToken, "access-1")
        XCTAssertEqual(transport.requests(matching: tokenURL).count, 2)
        let nonce = await client.currentNonce
        XCTAssertEqual(nonce, "server-nonce-2")
        let body = transport.requests(matching: tokenURL).last!.formBody
        XCTAssertEqual(body["grant_type"], "authorization_code")
        XCTAssertEqual(body["code_verifier"], "verifier")
        XCTAssertEqual(body["client_id"], Fixtures.client.clientID)
    }

    func testRefreshWithInvalidGrantIsSessionExpired() async {
        let transport = StubTransport()
        transport.json("POST", Fixtures.authServer.tokenEndpoint.absoluteString, status: 400,
                       ["error": "invalid_grant", "error_description": "refresh token revoked"])
        do {
            _ = try await makeClient(transport).refresh(refreshToken: "stale")
            XCTFail("expected sessionExpired")
        } catch {
            XCTAssertEqual(error as? ATProtoError, .sessionExpired)
        }
    }

    func testRejectsTokensWithoutAtprotoScopeOrBearerType() async {
        let transport = StubTransport()
        var json = Fixtures.tokenJSON()
        json["scope"] = "transition:generic"
        transport.json("POST", Fixtures.authServer.tokenEndpoint.absoluteString, json)
        do {
            _ = try await makeClient(transport).exchangeCode("c", codeVerifier: "v", redirectURI: "r")
            XCTFail("expected invalid_scope")
        } catch {
            XCTAssertEqual(error as? ATProtoError, .oauth(error: "invalid_scope", description: "server did not grant the atproto scope"))
        }

        json = Fixtures.tokenJSON()
        json["token_type"] = "Bearer"
        transport.json("POST", Fixtures.authServer.tokenEndpoint.absoluteString, json)
        do {
            _ = try await makeClient(transport).exchangeCode("c", codeVerifier: "v", redirectURI: "r")
            XCTFail("expected invalidResponse")
        } catch {
            if case .invalidResponse = (error as? ATProtoError) {} else { XCTFail("unexpected \(error)") }
        }
    }

    func testPARSendsClientIDAndReadsRequestURI() async throws {
        let transport = StubTransport()
        transport.json("POST", Fixtures.authServer.pushedAuthorizationRequestEndpoint.absoluteString, status: 201,
                       ["request_uri": "urn:ietf:params:oauth:request_uri:abc", "expires_in": 60])
        let response = try await makeClient(transport).pushAuthorizationRequest(["state": "s"])
        XCTAssertEqual(response.requestURI, "urn:ietf:params:oauth:request_uri:abc")
        let body = transport.requests.last!.formBody
        XCTAssertEqual(body["client_id"], Fixtures.client.clientID)
        XCTAssertEqual(body["state"], "s")
        XCTAssertEqual(transport.requests.last?.value(forHTTPHeaderField: "Content-Type"), "application/x-www-form-urlencoded")
    }
}
