import Foundation
import OpenReelATProto

/// Where this build signs in. Debug builds sign in against `Backend.current`:
/// on the dev server as a native client whose metadata that server hosts, on
/// the local Compose stack (`OPENREEL_BACKEND=local`) as the spec's loopback
/// client. Release builds are the published native client whose metadata
/// lives at `clientID`.
enum AppAuthConfiguration {
    #if DEBUG
    /// The dev server's nginx serves the metadata document
    /// (`infra/dev-server/nginx/openreel.zackmurry.com`). The loopback client
    /// is not used there: in the Simulator, sign-in hung after the server's
    /// redirect to `http://127.0.0.1`, while a custom-scheme redirect is
    /// handed back by `ASWebAuthenticationSession` itself.
    static let client: OAuthClientConfiguration = Backend.current.isLocal
        ? .loopback(redirectURI: URL(string: "http://127.0.0.1/oauth/callback")!)
        : OAuthClientConfiguration(
            clientID: "https://openreel.zackmurry.com/oauth/ios-client-metadata.json",
            redirectURI: "com.zackmurry.openreel:/oauth/callback"
        )

    /// Both deployments run a private PLC directory, so DIDs resolve there
    /// rather than at plc.directory; handles resolve through the PDS.
    static let identity = IdentityResolverConfiguration(
        plcDirectoryURL: Backend.current.plcURL,
        handleResolverURL: Backend.current.pdsURL,
        allowInsecureLocalhost: Backend.current.isLocal
    )

    static let signInPlaceholder = Backend.current.isLocal
        ? "alice.pds.example.com or localhost:3000"
        : "you.openreel.zackmurry.com"
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
