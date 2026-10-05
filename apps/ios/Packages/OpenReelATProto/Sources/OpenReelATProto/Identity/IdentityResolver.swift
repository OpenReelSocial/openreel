import Foundation

/// A DID bound to the PDS that hosts it, plus the handle if it verified.
public struct ResolvedIdentity: Hashable, Sendable, Codable {
    public let did: DID
    /// `nil` when the DID document's handle did not resolve back to the DID.
    /// Display the DID in that case; never show an unverified handle.
    public let handle: Handle?
    public let pdsURL: URL

    public init(did: DID, handle: Handle?, pdsURL: URL) {
        self.did = did
        self.handle = handle
        self.pdsURL = pdsURL
    }

    public var displayName: String { handle.map { "@\($0.rawValue)" } ?? did.rawValue }
}

public struct IdentityResolverConfiguration: Sendable {
    /// PLC directory used for `did:plc` documents. Local development points this
    /// at the private PLC in `infra/pds/compose.yaml`; deployed builds use the
    /// public registry.
    public var plcDirectoryURL: URL
    /// XRPC service used for `com.atproto.identity.resolveHandle` when the
    /// client cannot resolve a handle itself. Mobile apps have no clean DNS TXT
    /// API, so this is how `_atproto.<handle>` records get honoured.
    public var handleResolverURL: URL?
    /// Permit `http://localhost` identities and documents. Debug builds only.
    public var allowInsecureLocalhost: Bool

    public init(plcDirectoryURL: URL = URL(string: "https://plc.directory")!,
                handleResolverURL: URL? = nil,
                allowInsecureLocalhost: Bool = false) {
        self.plcDirectoryURL = plcDirectoryURL
        self.handleResolverURL = handleResolverURL
        self.allowInsecureLocalhost = allowInsecureLocalhost
    }
}

/// Handle → DID → DID document → PDS, with the bidirectional check the OAuth
/// spec makes mandatory when a flow starts from a handle.
public struct IdentityResolver: Sendable {
    public let configuration: IdentityResolverConfiguration
    private let http: HTTPClient

    public init(configuration: IdentityResolverConfiguration, transport: any HTTPTransport = URLSessionTransport()) {
        self.configuration = configuration
        self.http = HTTPClient(transport: transport)
    }

    /// Accepts a handle (with or without `@`) or a DID.
    public func resolveIdentity(_ identifier: String) async throws -> ResolvedIdentity {
        if DID.isDIDString(identifier) {
            return try await resolveIdentity(did: try DID(identifier))
        }
        let handle = try Handle(identifier)
        let did = try await resolveHandle(handle)
        let document = try await resolveDIDDocument(did)
        guard document.claims(handle: handle) else {
            throw ATProtoError.handleMismatch(handle: handle.rawValue, did: did.rawValue)
        }
        return try identity(from: document, did: did, verifiedHandle: handle)
    }

    /// Starting from a DID the handle is only decorative until it resolves back
    /// to the same DID; a failed check yields `handle == nil` rather than an
    /// error so a stale handle never blocks sign-in.
    public func resolveIdentity(did: DID) async throws -> ResolvedIdentity {
        let document = try await resolveDIDDocument(did)
        var verified: Handle?
        if let claimed = document.handle, let handle = try? Handle(claimed),
           let resolved = try? await resolveHandle(handle), resolved == did {
            verified = handle
        }
        return try identity(from: document, did: did, verifiedHandle: verified)
    }

    public func resolveHandle(_ handle: Handle) async throws -> DID {
        if let did = try await resolveHandleViaWellKnown(handle) {
            return did
        }
        guard let resolver = configuration.handleResolverURL else {
            throw ATProtoError.identityNotFound(handle.rawValue)
        }
        let client = XRPCClient(serviceURL: resolver, transport: http.transport)
        do {
            let output = try await client.query(
                "com.atproto.identity.resolveHandle",
                parameters: ["handle": handle.rawValue],
                as: ResolveHandleOutput.self
            )
            return try DID(output.did)
        } catch ATProtoError.xrpc(let status, _, _) where status == 400 || status == 404 {
            throw ATProtoError.identityNotFound(handle.rawValue)
        }
    }

    public func resolveDIDDocument(_ did: DID) async throws -> DIDDocument {
        let url = try did.documentURL(
            plcDirectory: configuration.plcDirectoryURL,
            allowInsecureLocalhost: configuration.allowInsecureLocalhost
        )
        let response = try await http.get(url)
        if response.statusCode == 404 || response.statusCode == 410 {
            throw ATProtoError.identityNotFound(did.rawValue)
        }
        guard response.isSuccess else {
            throw ATProtoError.didResolutionFailed(did: did.rawValue, detail: "HTTP \(response.statusCode) from \(url.hostName ?? "?")")
        }
        let document: DIDDocument
        do {
            document = try JSONDecoder().decode(DIDDocument.self, from: response.body)
        } catch {
            throw ATProtoError.didResolutionFailed(did: did.rawValue, detail: "unparseable DID document")
        }
        guard document.id == did.rawValue else {
            throw ATProtoError.didResolutionFailed(did: did.rawValue, detail: "document id is \(document.id)")
        }
        return document
    }

    // MARK: - Private

    /// `https://<handle>/.well-known/atproto-did`. A miss is not an error; the
    /// handle may be published over DNS instead.
    private func resolveHandleViaWellKnown(_ handle: Handle) async throws -> DID? {
        guard let url = URL(string: "https://\(handle.rawValue)/.well-known/atproto-did") else { return nil }
        let response: HTTPResponse
        do {
            // Short timeout: this is a probe, and most handles have no web host.
            response = try await http.get(url, accept: "text/plain", timeout: 5)
        } catch ATProtoError.serverUnavailable {
            // Most handles have no HTTPS host at all; that is normal, not an outage.
            return nil
        }
        guard response.isSuccess,
              let body = String(data: response.body, encoding: .utf8)?
                  .trimmingCharacters(in: .whitespacesAndNewlines),
              let did = try? DID(body)
        else { return nil }
        return did
    }

    private func identity(from document: DIDDocument, did: DID, verifiedHandle: Handle?) throws -> ResolvedIdentity {
        guard let pdsURL = document.pdsEndpoint else {
            throw ATProtoError.didResolutionFailed(did: did.rawValue, detail: "no #atproto_pds service")
        }
        if pdsURL.scheme == "http", !(configuration.allowInsecureLocalhost && pdsURL.isLoopbackHost) {
            throw ATProtoError.didResolutionFailed(did: did.rawValue, detail: "PDS endpoint must use https")
        }
        return ResolvedIdentity(did: did, handle: verifiedHandle, pdsURL: pdsURL)
    }
}
