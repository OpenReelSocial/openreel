import CryptoKit
import Foundation

/// The asymmetric key a session's tokens are bound to (RFC 9449). One key is
/// generated per sign-in and persisted alongside the tokens; losing it makes
/// the tokens unusable, which is the point.
public protocol DPoPSigningKey: Sendable {
    /// Public key as a JWK (`kty`, `crv`, `x`, `y`), embedded in every proof.
    var publicJWK: [String: String] { get }
    /// Opaque bytes sufficient to reconstruct the private key via the factory.
    var rawRepresentation: Data { get }
    /// JWS signature over `message` in the raw `r || s` form ES256 expects.
    func sign(_ message: Data) throws -> Data
}

public protocol DPoPKeyFactory: Sendable {
    func makeKey() -> any DPoPSigningKey
    func key(from rawRepresentation: Data) throws -> any DPoPSigningKey
}

/// P-256 key backed by CryptoKit. `rawRepresentation` is the 32-byte private
/// scalar, so it must only ever be stored in the Keychain.
// @unchecked only because older SDKs do not mark CryptoKit keys Sendable; the
// struct is immutable.
public struct P256DPoPKey: DPoPSigningKey, @unchecked Sendable {
    private let privateKey: P256.Signing.PrivateKey

    public init() {
        privateKey = P256.Signing.PrivateKey()
    }

    public init(rawRepresentation: Data) throws {
        privateKey = try P256.Signing.PrivateKey(rawRepresentation: rawRepresentation)
    }

    public var rawRepresentation: Data { privateKey.rawRepresentation }

    public var publicJWK: [String: String] {
        // x963 is 0x04 || X (32 bytes) || Y (32 bytes).
        let x963 = privateKey.publicKey.x963Representation
        let x = x963.subdata(in: 1..<33)
        let y = x963.subdata(in: 33..<65)
        return [
            "kty": "EC",
            "crv": "P-256",
            "x": x.base64URLEncodedString(),
            "y": y.base64URLEncodedString(),
        ]
    }

    public func sign(_ message: Data) throws -> Data {
        try privateKey.signature(for: message).rawRepresentation
    }
}

public struct P256DPoPKeyFactory: DPoPKeyFactory {
    public init() {}
    public func makeKey() -> any DPoPSigningKey { P256DPoPKey() }
    public func key(from rawRepresentation: Data) throws -> any DPoPSigningKey {
        try P256DPoPKey(rawRepresentation: rawRepresentation)
    }
}

/// Builds `DPoP` header values. Pure: all nondeterminism (time, `jti`) is
/// injectable so tests can assert on exact claims.
public struct DPoPProofGenerator: Sendable {
    public let key: any DPoPSigningKey

    public init(key: any DPoPSigningKey) {
        self.key = key
    }

    /// - Parameters:
    ///   - nonce: the most recent `DPoP-Nonce` the target server sent, if any.
    ///   - accessToken: set for resource-server requests so `ath` binds the
    ///     proof to the token; omit for token-endpoint requests.
    public func proof(method: String, url: URL, nonce: String?, accessToken: String? = nil,
                      issuedAt: Date = Date(), jti: String = UUID().uuidString) throws -> String {
        let header: [String: Any] = [
            "typ": "dpop+jwt",
            "alg": "ES256",
            "jwk": key.publicJWK,
        ]
        var payload: [String: Any] = [
            "jti": jti,
            "htm": method.uppercased(),
            "htu": Self.htu(for: url),
            "iat": Int(issuedAt.timeIntervalSince1970),
        ]
        if let nonce { payload["nonce"] = nonce }
        if let accessToken { payload["ath"] = SHA256Digest.base64URL(of: accessToken) }
        let signingInput = try Self.segment(header) + "." + Self.segment(payload)
        let signature = try key.sign(Data(signingInput.utf8))
        return signingInput + "." + signature.base64URLEncodedString()
    }

    /// RFC 9449 §4.2: the target URI without query or fragment.
    static func htu(for url: URL) -> String {
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        components?.query = nil
        components?.fragment = nil
        return components?.string ?? url.absoluteString
    }

    private static func segment(_ object: [String: Any]) throws -> String {
        // Dictionaries are unordered; sortedKeys keeps the encoded form stable.
        let data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys, .withoutEscapingSlashes])
        return data.base64URLEncodedString()
    }
}

/// Reads a `DPoP-Nonce`/`WWW-Authenticate` pair the way both the token endpoint
/// and the PDS report nonce problems.
enum DPoPResponse {
    /// Token/PAR endpoints: HTTP 400 with `{"error":"use_dpop_nonce"}`.
    /// Resource servers: HTTP 401 with `WWW-Authenticate: DPoP error="use_dpop_nonce"`.
    static func requiresNewNonce(_ response: HTTPResponse) -> Bool {
        if response.statusCode == 400,
           let body = try? JSONDecoder().decode(OAuthErrorBody.self, from: response.body),
           body.error == "use_dpop_nonce" {
            return true
        }
        if response.statusCode == 401,
           let challenge = response.header("WWW-Authenticate"),
           challenge.lowercased().contains("use_dpop_nonce") {
            return true
        }
        return false
    }

    static func nonce(_ response: HTTPResponse) -> String? {
        response.header("DPoP-Nonce")
    }
}

public struct OAuthErrorBody: Decodable, Sendable, Equatable {
    public let error: String
    public let errorDescription: String?

    private enum CodingKeys: String, CodingKey {
        case error
        case errorDescription = "error_description"
    }
}
