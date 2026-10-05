import Foundation
@testable import OpenReelATProto

/// Routes requests to canned responses by method + URL prefix, recording every
/// request so tests can assert on headers and bodies.
final class StubTransport: HTTPTransport, @unchecked Sendable {
    typealias Handler = @Sendable (URLRequest) throws -> HTTPResponse

    private let lock = NSLock()
    private var routes: [(method: String, prefix: String, handler: Handler)] = []
    private(set) var requests: [URLRequest] = []

    func on(_ method: String, _ prefix: String, _ handler: @escaping Handler) {
        lock.withLock { routes.append((method, prefix, handler)) }
    }

    func json(_ method: String, _ prefix: String, status: Int = 200, headers: [String: String] = [:], _ object: Any) {
        let body = try! JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        on(method, prefix) { _ in HTTPResponse(statusCode: status, headers: headers, body: body) }
    }

    func unavailable(_ method: String, _ prefix: String) {
        on(method, prefix) { request in
            throw ATProtoError.serverUnavailable(.unreachable(host: request.url?.hostName ?? "?"))
        }
    }

    func send(_ request: URLRequest) async throws -> HTTPResponse {
        lock.withLock { requests.append(request) }
        let method = request.httpMethod ?? "GET"
        let url = request.url?.absoluteString ?? ""
        // Later registrations win so a test can override a default.
        let match = lock.withLock {
            routes.last { $0.method == method && url.hasPrefix($0.prefix) }
        }
        guard let match else {
            throw ATProtoError.invalidResponse("unstubbed request: \(method) \(url)")
        }
        return try match.handler(request)
    }

    func requests(matching prefix: String) -> [URLRequest] {
        lock.withLock { requests.filter { ($0.url?.absoluteString ?? "").hasPrefix(prefix) } }
    }
}

/// Deterministic stand-in for CryptoKit so proofs are byte-for-byte checkable.
struct FakeDPoPKey: DPoPSigningKey {
    let rawRepresentation: Data
    var publicJWK: [String: String] {
        ["kty": "EC", "crv": "P-256", "x": "fake-x", "y": "fake-y"]
    }
    func sign(_ message: Data) throws -> Data {
        Data("sig:".utf8) + rawRepresentation.prefix(4)
    }
}

struct FakeDPoPKeyFactory: DPoPKeyFactory {
    func makeKey() -> any DPoPSigningKey { FakeDPoPKey(rawRepresentation: Data([1, 2, 3, 4])) }
    func key(from rawRepresentation: Data) throws -> any DPoPSigningKey { FakeDPoPKey(rawRepresentation: rawRepresentation) }
}

enum Fixtures {
    static let pds = URL(string: "https://pds.example.com")!
    static let plc = URL(string: "https://plc.test")!
    static let did = try! DID("did:plc:abcdefghijklmnop")
    static let handle = try! Handle("alice.example.com")

    static let client = OAuthClientConfiguration(
        clientID: "https://openreel.social/oauth/ios-client-metadata.json",
        redirectURI: "social.openreel:/oauth/callback"
    )

    static var authServer: AuthorizationServerMetadata {
        AuthorizationServerMetadata(
            issuer: pds,
            authorizationEndpoint: pds.appending(path: "oauth/authorize"),
            tokenEndpoint: pds.appending(path: "oauth/token"),
            pushedAuthorizationRequestEndpoint: pds.appending(path: "oauth/par"),
            revocationEndpoint: pds.appending(path: "oauth/revoke"),
            scopesSupported: ["atproto", "transition:generic"]
        )
    }

    static var authServerJSON: [String: Any] {
        [
            "issuer": pds.absoluteString,
            "authorization_endpoint": pds.appending(path: "oauth/authorize").absoluteString,
            "token_endpoint": pds.appending(path: "oauth/token").absoluteString,
            "pushed_authorization_request_endpoint": pds.appending(path: "oauth/par").absoluteString,
            "revocation_endpoint": pds.appending(path: "oauth/revoke").absoluteString,
            "scopes_supported": ["atproto", "transition:generic"],
            "dpop_signing_alg_values_supported": ["ES256"],
            "code_challenge_methods_supported": ["S256"],
            "client_id_metadata_document_supported": true,
            "authorization_response_iss_parameter_supported": true,
        ]
    }

    static var didDocumentJSON: [String: Any] {
        [
            "id": did.rawValue,
            "alsoKnownAs": ["at://\(handle.rawValue)"],
            "service": [
                ["id": "#atproto_pds", "type": "AtprotoPersonalDataServer", "serviceEndpoint": pds.absoluteString],
            ],
        ]
    }

    static func tokenJSON(access: String = "access-1", refresh: String? = "refresh-1", expiresIn: Int = 300, sub: String = did.rawValue) -> [String: Any] {
        var json: [String: Any] = [
            "access_token": access,
            "token_type": "DPoP",
            "expires_in": expiresIn,
            "scope": "atproto transition:generic",
            "sub": sub,
        ]
        if let refresh { json["refresh_token"] = refresh }
        return json
    }

    static func session(accessToken: String = "access-0", refreshToken: String? = "refresh-0", expiresAt: Date?) -> OAuthSession {
        OAuthSession(
            identity: ResolvedIdentity(did: did, handle: handle, pdsURL: pds),
            authorizationServer: authServer,
            accessToken: accessToken,
            refreshToken: refreshToken,
            expiresAt: expiresAt,
            scope: "atproto transition:generic",
            dpopKey: Data([9, 9, 9, 9])
        )
    }

    /// Stubs identity resolution and server discovery for `did`/`handle`.
    static func stubIdentityAndDiscovery(_ transport: StubTransport) {
        transport.unavailable("GET", "https://\(handle.rawValue)/.well-known/atproto-did")
        transport.json("GET", pds.appending(path: "xrpc/com.atproto.identity.resolveHandle").absoluteString, ["did": did.rawValue])
        transport.json("GET", plc.appending(path: did.rawValue).absoluteString, didDocumentJSON)
        transport.json("GET", pds.appending(path: ".well-known/oauth-protected-resource").absoluteString,
                       ["resource": pds.absoluteString, "authorization_servers": [pds.absoluteString]])
        transport.json("GET", pds.appending(path: ".well-known/oauth-authorization-server").absoluteString, authServerJSON)
    }
}

extension URLRequest {
    var formBody: [String: String] { FormEncoding.decode(httpBody ?? Data()) }
}

/// Decodes the unsigned JWT segments of a DPoP proof.
func decodeProof(_ proof: String) -> (header: [String: Any], payload: [String: Any]) {
    let parts = proof.split(separator: ".").map(String.init)
    func decode(_ segment: String) -> [String: Any] {
        guard let data = Data(base64URLEncoded: segment),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return [:] }
        return object
    }
    return (decode(parts[0]), decode(parts[1]))
}
