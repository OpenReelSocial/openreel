import Foundation
import OpenReelATProto

/// Where this build signs in. Debug builds talk to the local Compose stack
/// (`make up`) as a loopback OAuth client; release builds are the published
/// native client whose metadata lives at `clientID`.
enum AppAuthConfiguration {
    #if DEBUG
    /// `infra/pds/compose.yaml` publishes the PDS on 3000 and the private PLC
    /// directory on 2582. Simulator only: a device cannot reach the Mac's
    /// localhost.
    static let localPDS = URL(string: "http://localhost:3000")!
    static let localPLC = URL(string: "http://localhost:2582")!

    static let client = OAuthClientConfiguration.loopback(
        redirectURI: URL(string: "http://127.0.0.1/oauth/callback")!
    )

    static let identity = IdentityResolverConfiguration(
        plcDirectoryURL: localPLC,
        handleResolverURL: localPDS,
        allowInsecureLocalhost: true
    )

    static let signInPlaceholder = "alice.pds.example.com or localhost:3000"
    #else
    /// The `client_id` is the URL of `apps/ios/OAuth/ios-client-metadata.json`
    /// as hosted on the project domain (ADR-0001); the redirect scheme is
    /// that host reversed, as the atproto OAuth profile requires.
    static let client = OAuthClientConfiguration(
        clientID: "https://openreel.social/oauth/ios-client-metadata.json",
        redirectURI: "social.openreel:/oauth/callback"
    )

    /// iOS has no DNS TXT lookup, so handles that do not publish
    /// `/.well-known/atproto-did` fall back to the public Bluesky resolver
    /// until OpenReel runs its own AppView.
    static let identity = IdentityResolverConfiguration(
        plcDirectoryURL: URL(string: "https://plc.directory")!,
        handleResolverURL: URL(string: "https://public.api.bsky.app")!
    )

    static let signInPlaceholder = "handle, DID, or server"
    #endif

    static let callbackPath = "/oauth/callback"

    /// Custom scheme `ASWebAuthenticationSession` should intercept, or `nil`
    /// for the loopback client whose redirect is caught by our own listener.
    static var callbackURLScheme: String? {
        client.isLoopbackClient ? nil : URL(string: client.redirectURI)?.scheme
    }
}
