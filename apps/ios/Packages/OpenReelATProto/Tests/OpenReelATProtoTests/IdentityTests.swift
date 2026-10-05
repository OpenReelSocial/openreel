import XCTest
@testable import OpenReelATProto

final class IdentifierSyntaxTests: XCTestCase {
    func testAcceptsBlessedDIDMethods() throws {
        XCTAssertEqual(try DID("did:plc:abc123").method, "plc")
        XCTAssertEqual(try DID(" did:web:example.com\n").rawValue, "did:web:example.com")
    }

    func testRejectsOtherDIDs() {
        for bad in ["did:key:z6Mk", "did:plc:", "plc:abc", "did:plc:abc:", "did:PLC:abc", "did:web:exa mple.com"] {
            XCTAssertThrowsError(try DID(bad), bad)
        }
    }

    func testHandleNormalisesAndValidates() throws {
        XCTAssertEqual(try Handle("@Alice.Example.COM").rawValue, "alice.example.com")
        XCTAssertEqual(try Handle("sample-1.pds.example.com").rawValue, "sample-1.pds.example.com")
        for bad in ["alice", "-alice.com", "alice-.com", "alice.123", "alice.local", "alice.localhost", "a..b", "alice.c"] {
            XCTAssertThrowsError(try Handle(bad), bad)
        }
    }

    func testDIDAndHandleEncodeAsBareStrings() throws {
        let data = try JSONEncoder().encode([try DID("did:plc:abc"), try DID("did:web:x.com")])
        XCTAssertEqual(String(decoding: data, as: UTF8.self), #"["did:plc:abc","did:web:x.com"]"#)
        let handles = try JSONDecoder().decode([Handle].self, from: Data(#"["Bob.Example.com"]"#.utf8))
        XCTAssertEqual(handles.first?.rawValue, "bob.example.com")
    }

    func testDIDWebDocumentURL() throws {
        let url = try DID("did:web:pds.example.com").documentURL(plcDirectory: Fixtures.plc, allowInsecureLocalhost: false)
        XCTAssertEqual(url.absoluteString, "https://pds.example.com/.well-known/did.json")
        let local = try DID("did:web:localhost%3A3000").documentURL(plcDirectory: Fixtures.plc, allowInsecureLocalhost: true)
        XCTAssertEqual(local.absoluteString, "http://localhost:3000/.well-known/did.json")
    }
}

final class DIDDocumentTests: XCTestCase {
    func testExtractsHandleAndPDS() throws {
        let document = try JSONDecoder().decode(DIDDocument.self, from: JSONSerialization.data(withJSONObject: Fixtures.didDocumentJSON))
        XCTAssertEqual(document.handle, "alice.example.com")
        XCTAssertEqual(document.pdsEndpoint, Fixtures.pds)
        XCTAssertTrue(document.claims(handle: Fixtures.handle))
        XCTAssertFalse(document.claims(handle: try Handle("mallory.example.com")))
    }

    func testIgnoresUnrelatedAndMalformedServices() throws {
        let json: [String: Any] = [
            "id": "did:plc:x",
            "service": [
                ["id": "#atproto_labeler", "type": "AtprotoLabeler", "serviceEndpoint": "https://labeler.example"],
                ["id": "#atproto_pds", "type": "AtprotoPersonalDataServer", "serviceEndpoint": ["nested": "object"]],
            ],
        ]
        let document = try JSONDecoder().decode(DIDDocument.self, from: JSONSerialization.data(withJSONObject: json))
        XCTAssertNil(document.pdsEndpoint)
        XCTAssertNil(document.handle)
    }

    func testFullyQualifiedServiceIDIsAccepted() throws {
        let json: [String: Any] = [
            "id": "did:plc:x",
            "service": [["id": "did:plc:x#atproto_pds", "type": "AtprotoPersonalDataServer", "serviceEndpoint": "https://pds.example"]],
        ]
        let document = try JSONDecoder().decode(DIDDocument.self, from: JSONSerialization.data(withJSONObject: json))
        XCTAssertEqual(document.pdsEndpoint?.absoluteString, "https://pds.example")
    }
}

final class IdentityResolverTests: XCTestCase {
    private var transport: StubTransport!
    private var resolver: IdentityResolver!

    override func setUp() {
        transport = StubTransport()
        resolver = IdentityResolver(
            configuration: IdentityResolverConfiguration(plcDirectoryURL: Fixtures.plc, handleResolverURL: Fixtures.pds),
            transport: transport
        )
    }

    func testHandleResolvesViaWellKnownWhenPublished() async throws {
        transport.on("GET", "https://alice.example.com/.well-known/atproto-did") { _ in
            HTTPResponse(statusCode: 200, body: Data("\(Fixtures.did.rawValue)\n".utf8))
        }
        transport.json("GET", Fixtures.plc.appending(path: Fixtures.did.rawValue).absoluteString, Fixtures.didDocumentJSON)

        let identity = try await resolver.resolveIdentity("@Alice.example.com")

        XCTAssertEqual(identity.did, Fixtures.did)
        XCTAssertEqual(identity.handle, Fixtures.handle)
        XCTAssertEqual(identity.pdsURL, Fixtures.pds)
        XCTAssertTrue(transport.requests(matching: Fixtures.pds.absoluteString + "/xrpc").isEmpty, "no XRPC fallback needed")
    }

    func testHandleFallsBackToXRPCResolver() async throws {
        Fixtures.stubIdentityAndDiscovery(transport)

        let identity = try await resolver.resolveIdentity("alice.example.com")

        XCTAssertEqual(identity.did, Fixtures.did)
        XCTAssertEqual(transport.requests(matching: Fixtures.pds.absoluteString + "/xrpc/com.atproto.identity.resolveHandle").count, 1)
    }

    func testUnknownHandleIsNotFound() async {
        transport.unavailable("GET", "https://nobody.example.com")
        transport.json("GET", Fixtures.pds.appending(path: "xrpc/com.atproto.identity.resolveHandle").absoluteString,
                       status: 400, ["error": "InvalidRequest", "message": "Unable to resolve handle"])

        do {
            _ = try await resolver.resolveIdentity("nobody.example.com")
            XCTFail("expected identityNotFound")
        } catch {
            XCTAssertEqual(error as? ATProtoError, .identityNotFound("nobody.example.com"))
        }
    }

    func testHandleNotClaimedByDocumentIsRejected() async {
        Fixtures.stubIdentityAndDiscovery(transport)
        var document = Fixtures.didDocumentJSON
        document["alsoKnownAs"] = ["at://someone-else.example.com"]
        transport.json("GET", Fixtures.plc.appending(path: Fixtures.did.rawValue).absoluteString, document)

        do {
            _ = try await resolver.resolveIdentity("alice.example.com")
            XCTFail("expected handleMismatch")
        } catch {
            XCTAssertEqual(error as? ATProtoError, .handleMismatch(handle: "alice.example.com", did: Fixtures.did.rawValue))
        }
    }

    func testDIDInputVerifiesHandleBidirectionally() async throws {
        Fixtures.stubIdentityAndDiscovery(transport)
        // The document claims alice, but alice resolves to a different DID.
        transport.json("GET", Fixtures.pds.appending(path: "xrpc/com.atproto.identity.resolveHandle").absoluteString, ["did": "did:plc:someoneelse"])

        let identity = try await resolver.resolveIdentity(Fixtures.did.rawValue)

        XCTAssertEqual(identity.did, Fixtures.did)
        XCTAssertNil(identity.handle, "unverified handle must not be surfaced")
        XCTAssertEqual(identity.displayName, Fixtures.did.rawValue)
    }

    func testPLCOutageSurfacesAsServerUnavailable() async {
        transport.unavailable("GET", "https://alice.example.com")
        transport.json("GET", Fixtures.pds.appending(path: "xrpc/com.atproto.identity.resolveHandle").absoluteString, ["did": Fixtures.did.rawValue])
        transport.on("GET", Fixtures.plc.absoluteString) { _ in HTTPResponse(statusCode: 503) }

        do {
            _ = try await resolver.resolveIdentity("alice.example.com")
            XCTFail("expected serverUnavailable")
        } catch {
            XCTAssertEqual(error as? ATProtoError, .serverUnavailable(.serverError(host: "plc.test", status: 503)))
        }
    }

    func testDocumentWithoutPDSFails() async {
        var document = Fixtures.didDocumentJSON
        document["service"] = [Any]()
        transport.json("GET", Fixtures.plc.appending(path: Fixtures.did.rawValue).absoluteString, document)
        transport.unavailable("GET", "https://alice.example.com")
        transport.json("GET", Fixtures.pds.appending(path: "xrpc/com.atproto.identity.resolveHandle").absoluteString, ["did": Fixtures.did.rawValue])

        do {
            _ = try await resolver.resolveIdentity(Fixtures.did.rawValue)
            XCTFail("expected didResolutionFailed")
        } catch {
            XCTAssertEqual(error as? ATProtoError, .didResolutionFailed(did: Fixtures.did.rawValue, detail: "no #atproto_pds service"))
        }
    }
}
