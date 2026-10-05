import Foundation

/// Everything needed to resume an authenticated session after relaunch. The
/// whole value is secret (tokens plus DPoP private key) and belongs in the
/// Keychain, never in UserDefaults or logs.
public struct OAuthSession: Codable, Equatable, Sendable {
    public var identity: ResolvedIdentity
    /// Authorization server the tokens came from; refresh and revoke go here.
    public var authorizationServer: AuthorizationServerMetadata
    public var accessToken: String
    public var refreshToken: String?
    public var expiresAt: Date?
    public var scope: String
    public var dpopKey: Data
    public var createdAt: Date

    public init(identity: ResolvedIdentity, authorizationServer: AuthorizationServerMetadata,
                accessToken: String, refreshToken: String?, expiresAt: Date?, scope: String,
                dpopKey: Data, createdAt: Date = Date()) {
        self.identity = identity
        self.authorizationServer = authorizationServer
        self.accessToken = accessToken
        self.refreshToken = refreshToken
        self.expiresAt = expiresAt
        self.scope = scope
        self.dpopKey = dpopKey
        self.createdAt = createdAt
    }

    public var did: DID { identity.did }
    public var handle: Handle? { identity.handle }
    public var pdsURL: URL { identity.pdsURL }

    /// True once the access token is within `leeway` of expiring. Tokens are
    /// short-lived (minutes), so refreshing a little early avoids a wasted
    /// round trip that would fail with `invalid_token` anyway.
    public func needsRefresh(at now: Date = Date(), leeway: TimeInterval = 30) -> Bool {
        guard let expiresAt else { return false }
        return now.addingTimeInterval(leeway) >= expiresAt
    }

    mutating func apply(_ token: OAuthTokenResponse, at now: Date = Date()) {
        accessToken = token.accessToken
        // A refresh response may omit the refresh token, meaning "keep using
        // the one you have".
        if let refreshed = token.refreshToken { refreshToken = refreshed }
        expiresAt = token.expiresIn.map { now.addingTimeInterval(TimeInterval($0)) }
        if let scope = token.scope { self.scope = scope }
    }
}

/// Where a session is kept between launches.
public protocol SessionStore: Sendable {
    func load() throws -> OAuthSession?
    func save(_ session: OAuthSession) throws
    func clear() throws
}

/// For previews and tests.
public final class InMemorySessionStore: SessionStore, @unchecked Sendable {
    private let lock = NSLock()
    private var session: OAuthSession?

    public init(session: OAuthSession? = nil) {
        self.session = session
    }

    public func load() throws -> OAuthSession? {
        lock.withLock { session }
    }

    public func save(_ session: OAuthSession) throws {
        lock.withLock { self.session = session }
    }

    public func clear() throws {
        lock.withLock { session = nil }
    }
}
