import Foundation

/// Identity of this app as an OAuth public client. In the atproto profile the
/// `client_id` *is* the URL of a hosted client metadata document; the server
/// fetches it rather than having clients pre-register.
public struct OAuthClientConfiguration: Sendable, Equatable {
    /// `https://.../client-metadata.json`, or `http://localhost?...` for the
    /// spec's loopback development mode.
    public let clientID: String
    /// Exact redirect URI sent in PAR; must be declared by the metadata document.
    public let redirectURI: String
    /// Space-separated. Must include `atproto`; `transition:generic` is what
    /// gives a client ordinary repo read/write access today.
    public let scope: String
    /// Accept `http://localhost` issuers and endpoints. Only for the local PDS
    /// (`PDS_DEV_MODE=true`); a deployed server must be https.
    public let allowInsecureLocalhost: Bool

    public static let defaultScope = "atproto transition:generic"

    public init(clientID: String, redirectURI: String, scope: String = OAuthClientConfiguration.defaultScope, allowInsecureLocalhost: Bool = false) {
        self.clientID = clientID
        self.redirectURI = redirectURI
        self.scope = scope
        self.allowInsecureLocalhost = allowInsecureLocalhost
    }

    /// The spec's "Localhost Client Development" mode: `client_id` is
    /// `http://localhost` with the redirect URI and scope carried as query
    /// parameters. Servers ignore the port in the redirect, so the listener
    /// can bind an ephemeral one.
    public static func loopback(redirectURI: URL, scope: String = OAuthClientConfiguration.defaultScope) -> OAuthClientConfiguration {
        var declared = URLComponents(url: redirectURI, resolvingAgainstBaseURL: false) ?? URLComponents()
        declared.port = nil
        var components = URLComponents(string: "http://localhost")!
        components.queryItems = [
            URLQueryItem(name: "redirect_uri", value: declared.string ?? redirectURI.absoluteString),
            URLQueryItem(name: "scope", value: scope),
        ]
        return OAuthClientConfiguration(
            clientID: components.string ?? "http://localhost",
            redirectURI: redirectURI.absoluteString,
            scope: scope,
            allowInsecureLocalhost: true
        )
    }

    public var isLoopbackClient: Bool {
        clientID == "http://localhost" || clientID.hasPrefix("http://localhost?")
    }

    public var scopes: Set<String> {
        Set(scope.split(separator: " ").map(String.init))
    }
}
