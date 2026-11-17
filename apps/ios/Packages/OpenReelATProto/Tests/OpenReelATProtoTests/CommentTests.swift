import XCTest
@testable import OpenReelATProto

final class CommentTests: XCTestCase {
    private let post = StrongRef(uri: "at://did:plc:author/social.openreel.video.post/1", cid: "bafypost")
    private let appView = URL(string: "https://appview.example.com")!
    private let createURL = Fixtures.pds.appending(path: "xrpc/com.atproto.repo.createRecord").absoluteString
    private let deleteURL = Fixtures.pds.appending(path: "xrpc/com.atproto.repo.deleteRecord").absoluteString

    private func signedIn(_ transport: StubTransport) async throws -> ATProtoSessionManager {
        let manager = ATProtoSessionManager(
            client: Fixtures.client,
            identity: IdentityResolverConfiguration(plcDirectoryURL: Fixtures.plc, handleResolverURL: Fixtures.pds),
            store: InMemorySessionStore(session: Fixtures.session(expiresAt: Date().addingTimeInterval(600))),
            transport: transport,
            keyFactory: FakeDPoPKeyFactory()
        )
        try await manager.restore()
        return manager
    }

    private func body(_ request: URLRequest?) throws -> [String: Any] {
        let data = try XCTUnwrap(try XCTUnwrap(request).httpBody)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    // MARK: - Reading

    func testGetCommentsDecodesViewsAndSkipsUnreadableOnes() async throws {
        let transport = StubTransport()
        transport.json("GET", appView.absoluteString, [
            "comments": [
                [
                    "uri": "at://did:plc:bob/social.openreel.video.comment/a", "cid": "bafya",
                    "author": ["did": "did:plc:bob", "handle": "bob.example.com"],
                    "record": ["text": "nice", "subject": ["uri": post.uri, "cid": post.cid], "createdAt": "2026-11-16T00:00:00.000Z"],
                    "replyCount": 2, "indexedAt": "2026-11-16T00:00:01.000Z",
                    "labels": [["src": "did:plc:labeler", "uri": "at://did:plc:bob/social.openreel.video.comment/a", "val": "spam", "cts": "2026-11-16T00:00:02.000Z"]],
                ],
                // No text: dropped.
                ["uri": "at://did:plc:eve/social.openreel.video.comment/b", "cid": "bafyb",
                 "author": ["did": "did:plc:eve"], "record": ["subject": ["uri": post.uri, "cid": post.cid]],
                 "indexedAt": "2026-11-16T00:00:01.000Z"],
                // Malformed: dropped.
                ["uri": 42],
            ],
            "cursor": "next",
        ])
        let client = AppViewClient(serviceURL: appView, labelers: [LabelerSubscription(did: "did:plc:labeler", redact: true)], transport: transport)

        let page = try await client.getComments(on: post.uri, parent: "at://did:plc:bob/social.openreel.video.comment/a", limit: 20, cursor: "c1")

        XCTAssertEqual(page.cursor, "next")
        XCTAssertEqual(page.comments.map(\.uri), ["at://did:plc:bob/social.openreel.video.comment/a"])
        XCTAssertEqual(page.comments.first?.record?.text, "nice")
        XCTAssertEqual(page.comments.first?.replyCount, 2)
        XCTAssertEqual(page.comments.first?.labels.map(\.val), ["spam"])

        let sent = try XCTUnwrap(transport.requests.last)
        let items = URLComponents(url: try XCTUnwrap(sent.url), resolvingAgainstBaseURL: false)?.queryItems ?? []
        XCTAssertEqual(sent.url?.path, "/xrpc/social.openreel.video.getComments")
        XCTAssertEqual(Dictionary(uniqueKeysWithValues: items.map { ($0.name, $0.value ?? "") }), [
            "uri": post.uri, "parent": "at://did:plc:bob/social.openreel.video.comment/a", "limit": "20", "cursor": "c1",
        ])
        XCTAssertEqual(sent.value(forHTTPHeaderField: "atproto-accept-labelers"), "did:plc:labeler;redact")
    }

    func testPostViewDecodesCommentCount() throws {
        let json = """
        {"uri": "\(post.uri)", "cid": "bafy", "author": {"did": "did:plc:author"}, "record": {},
         "playlist": "https://media.example.com/a.m3u8", "indexedAt": "2026-11-01T00:00:00.000Z", "commentCount": 12}
        """
        XCTAssertEqual(try JSONDecoder().decode(VideoPostView.self, from: Data(json.utf8)).commentCount, 12)
    }

    func testMissingEndpointSurfacesAsXRPCError() async {
        let transport = StubTransport()
        transport.json("GET", appView.absoluteString, status: 404, ["error": "MethodNotImplemented", "message": "Method Not Implemented"])
        let client = AppViewClient(serviceURL: appView, transport: transport)
        do {
            _ = try await client.getComments(on: post.uri)
            XCTFail("expected an error")
        } catch let ATProtoError.xrpc(status, error, _) {
            XCTAssertEqual(status, 404)
            XCTAssertEqual(error, "MethodNotImplemented")
        } catch {
            XCTFail("unexpected \(error)")
        }
    }

    // MARK: - Writing

    func testPostsATrimmedTopLevelComment() async throws {
        let transport = StubTransport()
        let manager = try await signedIn(transport)
        transport.json("POST", createURL, ["uri": "at://\(Fixtures.did.rawValue)/social.openreel.video.comment/3k", "cid": "bafyc"])

        let output = try await manager.postComment("  where is this?  ", on: post, createdAt: Date(timeIntervalSince1970: 1_700_000_000))

        XCTAssertEqual(output.cid, "bafyc")
        let input = try body(transport.requests(matching: createURL).last)
        XCTAssertEqual(input["collection"] as? String, "social.openreel.video.comment")
        XCTAssertEqual(input["repo"] as? String, Fixtures.did.rawValue)
        let record = try XCTUnwrap(input["record"] as? [String: Any])
        XCTAssertEqual(record["$type"] as? String, "social.openreel.video.comment")
        XCTAssertEqual(record["text"] as? String, "where is this?")
        XCTAssertEqual(record["subject"] as? [String: String], ["uri": post.uri, "cid": post.cid])
        XCTAssertNil(record["parent"])
        XCTAssertEqual(record["createdAt"] as? String, "2023-11-14T22:13:20.000Z")
    }

    func testReplyPointsAtItsParent() async throws {
        let transport = StubTransport()
        let manager = try await signedIn(transport)
        transport.json("POST", createURL, ["uri": "at://\(Fixtures.did.rawValue)/social.openreel.video.comment/3m", "cid": "bafyr"])
        let parent = StrongRef(uri: "at://did:plc:bob/social.openreel.video.comment/a", cid: "bafya")

        _ = try await manager.postComment("agreed", on: post, parent: parent)

        let record = try XCTUnwrap(try body(transport.requests(matching: createURL).last)["record"] as? [String: Any])
        XCTAssertEqual(record["parent"] as? [String: String], ["uri": parent.uri, "cid": parent.cid])
    }

    func testRejectsEmptyAndOverlongCommentsWithoutSending() async throws {
        let transport = StubTransport()
        let manager = try await signedIn(transport)
        let before = transport.requests.count

        do {
            _ = try await manager.postComment("   \n ", on: post)
            XCTFail("expected empty")
        } catch let error as CommentError {
            XCTAssertEqual(error, .empty)
        }
        do {
            _ = try await manager.postComment(String(repeating: "a", count: 301), on: post)
            XCTFail("expected too long")
        } catch let error as CommentError {
            XCTAssertEqual(error, .tooLong(limit: 300))
        }
        XCTAssertEqual(transport.requests.count, before)
    }

    func testDeletesACommentByItsRecordKey() async throws {
        let transport = StubTransport()
        let manager = try await signedIn(transport)
        transport.json("POST", deleteURL, [:])

        try await manager.deleteComment(uri: "at://\(Fixtures.did.rawValue)/social.openreel.video.comment/3kabc")

        let input = try body(transport.requests(matching: deleteURL).last)
        XCTAssertEqual(input["collection"] as? String, "social.openreel.video.comment")
        XCTAssertEqual(input["rkey"] as? String, "3kabc")
    }

    func testRefusesToDeleteSomethingThatIsNotAComment() async throws {
        let transport = StubTransport()
        let manager = try await signedIn(transport)
        do {
            try await manager.deleteComment(uri: post.uri)
            XCTFail("expected an error")
        } catch ATProtoError.invalidResponse {}
        XCTAssertTrue(transport.requests(matching: deleteURL).isEmpty)
    }
}
