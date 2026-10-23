import XCTest
@testable import OpenReelATProto

final class FeedGeneratorTests: XCTestCase {
    private let appView = URL(string: "https://appview.example.com")!
    private var suggestedURL: String { appView.appending(path: "xrpc/social.openreel.feed.getSuggestedFeeds").absoluteString }

    func testDecodesSuggestedFeedsInOrder() async throws {
        let transport = StubTransport()
        transport.json("GET", suggestedURL, ["feeds": [
            [
                "uri": "at://openreel.social/social.openreel.feed.generator/recent",
                "displayName": "Latest",
                "description": "Newest first.",
                "rankingCriteria": "chronological",
            ],
            [
                "uri": "at://openreel.social/social.openreel.feed.generator/trending",
                "displayName": "Trending",
                "rankingCriteria": "heuristic",
                "weights": [
                    ["signal": "views", "weightBps": 7000],
                    ["signal": "recency", "weightBps": 3000, "halfLifeHours": 24],
                ],
            ],
        ]])

        let feeds = try await AppViewClient(serviceURL: appView, transport: transport).getSuggestedFeeds()

        XCTAssertEqual(feeds.map(\.displayName), ["Latest", "Trending"])
        XCTAssertEqual(feeds[0].weights, [])
        XCTAssertEqual(feeds[0].description, "Newest first.")
        XCTAssertEqual(feeds[1].weights, [
            RankingWeight(signal: "views", weightBps: 7000),
            RankingWeight(signal: "recency", weightBps: 3000, halfLifeHours: 24),
        ])
        XCTAssertEqual(feeds[1].weights[0].fraction, 0.7, accuracy: 0.0001)
    }

    func testMalformedWeightsHideTheWeightsNotTheFeed() async throws {
        let transport = StubTransport()
        transport.json("GET", suggestedURL, ["feeds": [[
            "uri": "at://openreel.social/social.openreel.feed.generator/new",
            "displayName": "New",
            "rankingCriteria": "hybrid",
            "weights": "secret sauce",
        ]]])

        let feeds = try await AppViewClient(serviceURL: appView, transport: transport).getSuggestedFeeds()

        XCTAssertEqual(feeds.map(\.rankingCriteria), ["hybrid"])
        XCTAssertEqual(feeds[0].weights, [])
    }
}

final class CreateRecordTests: XCTestCase {
    private let createURL = Fixtures.pds.appending(path: "xrpc/com.atproto.repo.createRecord").absoluteString

    func testWritesWatchEventToTheSignedInRepository() async throws {
        let transport = StubTransport()
        let store = InMemorySessionStore(session: Fixtures.session(expiresAt: Date().addingTimeInterval(600)))
        let manager = ATProtoSessionManager(
            client: Fixtures.client,
            identity: IdentityResolverConfiguration(plcDirectoryURL: Fixtures.plc, handleResolverURL: Fixtures.pds),
            store: store,
            transport: transport,
            keyFactory: FakeDPoPKeyFactory()
        )
        try await manager.restore()
        transport.json("POST", createURL, ["uri": "at://\(Fixtures.did.rawValue)/social.openreel.engagement.watchEvent/3k", "cid": "bafyreiw"])

        let record = WatchEventRecord(
            subject: StrongRef(uri: "at://did:plc:bob/social.openreel.video.post/3k1", cid: "bafyreipost"),
            watchDurationMs: 12_500,
            videoDurationMs: 8_000,
            soundEnabled: true,
            rewatchCount: 1,
            context: "feed",
            createdAt: Date(timeIntervalSince1970: 1_700_000_000)
        )
        let output = try await manager.createRecord(collection: WatchEventRecord.collection, record: record)

        XCTAssertEqual(output.cid, "bafyreiw")
        let sent = try XCTUnwrap(transport.requests(matching: createURL).last)
        XCTAssertEqual(sent.value(forHTTPHeaderField: "Authorization"), "DPoP access-0")
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: try XCTUnwrap(sent.httpBody)) as? [String: Any])
        XCTAssertEqual(body["repo"] as? String, Fixtures.did.rawValue)
        XCTAssertEqual(body["collection"] as? String, "social.openreel.engagement.watchEvent")
        let written = try XCTUnwrap(body["record"] as? [String: Any])
        XCTAssertEqual(written["$type"] as? String, "social.openreel.engagement.watchEvent")
        XCTAssertEqual(written["subject"] as? [String: String], ["uri": "at://did:plc:bob/social.openreel.video.post/3k1", "cid": "bafyreipost"])
        XCTAssertEqual(written["watchDurationMs"] as? Int, 12_500)
        XCTAssertEqual(written["videoDurationMs"] as? Int, 8_000)
        XCTAssertEqual(written["rewatchCount"] as? Int, 1)
        XCTAssertEqual(written["context"] as? String, "feed")
        XCTAssertEqual(written["createdAt"] as? String, "2023-11-14T22:13:20.000Z")
    }

    func testRequiresASession() async {
        let manager = ATProtoSessionManager(
            client: Fixtures.client,
            identity: IdentityResolverConfiguration(plcDirectoryURL: Fixtures.plc, handleResolverURL: Fixtures.pds),
            store: InMemorySessionStore(),
            transport: StubTransport()
        )
        do {
            _ = try await manager.createRecord(collection: WatchEventRecord.collection, record: StrongRef(uri: "at://x", cid: "y"))
            XCTFail("expected notSignedIn")
        } catch ATProtoError.notSignedIn {
        } catch {
            XCTFail("unexpected error \(error)")
        }
    }
}

final class LikeRecordTests: XCTestCase {
    private let createURL = Fixtures.pds.appending(path: "xrpc/com.atproto.repo.createRecord").absoluteString
    private let deleteURL = Fixtures.pds.appending(path: "xrpc/com.atproto.repo.deleteRecord").absoluteString
    private let listURL = Fixtures.pds.appending(path: "xrpc/com.atproto.repo.listRecords").absoluteString

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

    func testWritesALike() async throws {
        let transport = StubTransport()
        let manager = try await signedIn(transport)
        transport.json("POST", createURL, ["uri": "at://\(Fixtures.did.rawValue)/social.openreel.engagement.like/3k", "cid": "bafyreil"])

        let record = LikeRecord(
            subject: StrongRef(uri: "at://did:plc:bob/social.openreel.video.post/3k1", cid: "bafyreipost"),
            createdAt: Date(timeIntervalSince1970: 1_700_000_000)
        )
        _ = try await manager.createRecord(collection: LikeRecord.collection, record: record)

        let sent = try body(transport.requests(matching: createURL).last)
        XCTAssertEqual(sent["collection"] as? String, "social.openreel.engagement.like")
        let written = try XCTUnwrap(sent["record"] as? [String: Any])
        XCTAssertEqual(written["$type"] as? String, "social.openreel.engagement.like")
        XCTAssertEqual(written["subject"] as? [String: String], ["uri": "at://did:plc:bob/social.openreel.video.post/3k1", "cid": "bafyreipost"])
        XCTAssertEqual(written["createdAt"] as? String, "2023-11-14T22:13:20.000Z")
        XCTAssertEqual(written.count, 3)
    }

    func testDeletesFromTheSignedInRepository() async throws {
        let transport = StubTransport()
        let manager = try await signedIn(transport)
        transport.json("POST", deleteURL, [String: Any]())

        try await manager.deleteRecord(collection: LikeRecord.collection, rkey: "3k")

        let sent = try body(transport.requests(matching: deleteURL).last)
        XCTAssertEqual(sent["repo"] as? String, Fixtures.did.rawValue)
        XCTAssertEqual(sent["collection"] as? String, "social.openreel.engagement.like")
        XCTAssertEqual(sent["rkey"] as? String, "3k")
    }

    func testDeleteSurfacesXRPCErrors() async throws {
        let transport = StubTransport()
        let manager = try await signedIn(transport)
        transport.json("POST", deleteURL, status: 400, ["error": "InvalidRequest", "message": "nope"])

        do {
            try await manager.deleteRecord(collection: LikeRecord.collection, rkey: "3k")
            XCTFail("expected an XRPC error")
        } catch let ATProtoError.xrpc(status, error, _) {
            XCTAssertEqual(status, 400)
            XCTAssertEqual(error, "InvalidRequest")
        }
    }

    func testListsLikesKeepingUnreadableRecords() async throws {
        let transport = StubTransport()
        let manager = try await signedIn(transport)
        let likeURI = "at://\(Fixtures.did.rawValue)/social.openreel.engagement.like/3k1"
        transport.json("GET", listURL, [
            "records": [
                [
                    "uri": likeURI,
                    "cid": "bafyreil1",
                    "value": [
                        "$type": "social.openreel.engagement.like",
                        "subject": ["uri": "at://did:plc:bob/social.openreel.video.post/3p", "cid": "bafyreipost"],
                        "createdAt": "2026-10-05T00:00:00.000Z",
                    ],
                ],
                ["uri": "at://\(Fixtures.did.rawValue)/social.openreel.engagement.like/3k2", "cid": "bafyreil2", "value": ["subject": 7]],
            ],
            "cursor": "3k2",
        ])

        let page = try await manager.listRecords(collection: LikeRecord.collection, as: RecordSubject.self, cursor: "3k0")

        XCTAssertEqual(page.cursor, "3k2")
        XCTAssertEqual(page.records.map(\.uri), [likeURI, "at://\(Fixtures.did.rawValue)/social.openreel.engagement.like/3k2"])
        XCTAssertEqual(page.records[0].value?.subject.uri, "at://did:plc:bob/social.openreel.video.post/3p")
        XCTAssertNil(page.records[1].value)
        let query = try XCTUnwrap(URLComponents(url: try XCTUnwrap(transport.requests(matching: listURL).last?.url), resolvingAgainstBaseURL: false)?.queryItems)
        XCTAssertEqual(Dictionary(uniqueKeysWithValues: query.map { ($0.name, $0.value ?? "") }), [
            "repo": Fixtures.did.rawValue,
            "collection": "social.openreel.engagement.like",
            "limit": "100",
            "cursor": "3k0",
        ])
    }
}
