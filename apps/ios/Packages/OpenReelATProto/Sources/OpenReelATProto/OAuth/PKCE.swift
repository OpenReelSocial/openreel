import CryptoKit
import Foundation

/// RFC 7636 code verifier/challenge pair, S256 only (the atproto profile
/// requires it and forbids `plain`).
public struct PKCE: Sendable, Equatable {
    public let codeVerifier: String
    public let codeChallenge: String
    public static let codeChallengeMethod = "S256"

    public init(codeVerifier: String) {
        self.codeVerifier = codeVerifier
        self.codeChallenge = Data(SHA256.hash(data: Data(codeVerifier.utf8))).base64URLEncodedString()
    }

    /// 32 random bytes → 43 unreserved characters, inside the 43–128 range.
    public static func generate() -> PKCE {
        PKCE(codeVerifier: Data.random(count: 32).base64URLEncodedString())
    }
}

enum SHA256Digest {
    static func base64URL(of string: String) -> String {
        Data(SHA256.hash(data: Data(string.utf8))).base64URLEncodedString()
    }
}
