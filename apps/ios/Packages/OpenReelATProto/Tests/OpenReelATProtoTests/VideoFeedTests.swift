import XCTest
@testable import OpenReelATProto

final class VideoFeedTests: XCTestCase {
    private let appView = URL(string: "https://appview.example.com")!
    private var getFeedURL: String { appView.appending(path: "xrpc/social.openreel.feed.getFeed").absoluteString }

    private func postJSON(rkey: String, handle: String? = "alice.example.com") -> [String: Any] {
        var author: [String: Any] = ["did": "did:plc:alice"]
        if let handle { author["handle"] = handle }
        return [
            "uri": "at://did:plc:alice/social.openreel.video.post/\(rkey)",
            "cid": "bafyrei\(rkey)",
            "author": author,
            "record": [
                "$type": "social.openreel.video.post",
                "video": ["$type": "blob", "ref": ["$link": "bafkreivideo"], "mimeType": "video/mp4", "size": 1234],
                "caption": "Clip \(rkey)",
                "tags": ["demo"],
                "durationMs": 5000,
                "createdAt": "2026-10-05T00:00:00.000Z",
            ],
            "playlist": "https://media.example.com/did%3Aplc%3Aalice/bafkreivideo/playlist.m3u8",
            "thumbnail": "https://media.example.com/did%3Aplc%3Aalice/bafkreivideo/poster.jpg",
            "aspectRatio": ["width": 9, "height": 16],
            "durationMs": 5005,
            "indexedAt": "2026-10-05T00:00:01.000Z",
        ]
    }

    func testDecodesHydratedPostViews() async throws {
        let transport = StubTransport()
        transport.json("GET", getFeedURL, ["feed": [postJSON(rkey: "3k1"), postJSON(rkey: "3k2", handle: nil)], "cursor": "c1"])

        let page = try await AppViewClient(serviceURL: appView, transport: transport).getFeed()

        XCTAssertEqual(page.cursor, "c1")
        XCTAssertEqual(page.feed.map(\.id), [
            "at://did:plc:alice/social.openreel.video.post/3k1",
            "at://did:plc:alice/social.openreel.video.post/3k2",
        ])
        let first = page.feed[0]
        XCTAssertEqual(first.author, VideoAuthorView(did: "did:plc:alice", handle: "alice.example.com"))
        XCTAssertEqual(first.record, VideoPostRecord(caption: "Clip 3k1", tags: ["demo"], durationMs: 5000, createdAt: "2026-10-05T00:00:00.000Z"))
        XCTAssertEqual(first.playlist.absoluteString, "https://media.example.com/did%3Aplc%3Aalice/bafkreivideo/playlist.m3u8")
        XCTAssertEqual(first.thumbnail?.lastPathComponent, "poster.jpg")
        XCTAssertEqual(first.aspectRatio, VideoAspectRatio(width: 9, height: 16))
        XCTAssertEqual(first.aspectRatio?.value ?? 0, 0.5625, accuracy: 0.0001)
        XCTAssertEqual(first.durationMs, 5005)
        XCTAssertNil(page.feed[1].author.handle)
    }

    func testSendsOnlyTheGivenParameters() async throws {
        let transport = StubTransport()
        transport.json("GET", getFeedURL, ["feed": []])
        let client = AppViewClient(serviceURL: appView, transport: transport)

        let page = try await client.getFeed()
        _ = try await client.getFeed(feed: "at://did:plc:gen/social.openreel.feed.generator/recent", limit: 15, cursor: "1700000000000::at://x")

        XCTAssertEqual(page, VideoFeedPage(feed: [], cursor: nil))
        let requests = transport.requests(matching: getFeedURL)
        XCTAssertEqual(requests.count, 2)
        XCTAssertNil(URLComponents(url: requests[0].url!, resolvingAgainstBaseURL: false)?.queryItems)
        let query = URLComponents(url: requests[1].url!, resolvingAgainstBaseURL: false)?.queryItems ?? []
        XCTAssertEqual(Dictionary(uniqueKeysWithValues: query.map { ($0.name, $0.value ?? "") }), [
            "feed": "at://did:plc:gen/social.openreel.feed.generator/recent",
            "limit": "15",
            "cursor": "1700000000000::at://x",
        ])
        XCTAssertEqual(requests[1].value(forHTTPHeaderField: "Accept"), "application/json")
    }

    func testMalformedPostIsDroppedNotThePage() async throws {
        var noPlaylist = postJSON(rkey: "3k2")
        noPlaylist.removeValue(forKey: "playlist")
        var oddRecord = postJSON(rkey: "3k3")
        oddRecord["record"] = ["caption": 42]
        var oddOptionals = postJSON(rkey: "3k4")
        oddOptionals["aspectRatio"] = "tall"
        oddOptionals["durationMs"] = "long"

        let transport = StubTransport()
        transport.json("GET", getFeedURL, ["feed": [postJSON(rkey: "3k1"), noPlaylist, "garbage", oddRecord, oddOptionals]])

        let page = try await AppViewClient(serviceURL: appView, transport: transport).getFeed()

        XCTAssertEqual(page.feed.map { $0.uri.components(separatedBy: "/").last }, ["3k1", "3k3", "3k4"])
        XCTAssertNil(page.feed[1].record, "an unreadable record keeps the post but drops its metadata")
        XCTAssertNil(page.feed[2].aspectRatio)
        XCTAssertNil(page.feed[2].durationMs)
    }

    func testSurfacesXRPCErrors() async {
        let transport = StubTransport()
        transport.json("GET", getFeedURL, status: 400, ["error": "UnknownFeed", "message": "no such feed"])

        do {
            _ = try await AppViewClient(serviceURL: appView, transport: transport).getFeed(feed: "at://did:plc:x/social.openreel.feed.generator/nope")
            XCTFail("expected an error")
        } catch {
            XCTAssertEqual(error as? ATProtoError, .xrpc(status: 400, error: "UnknownFeed", message: "no such feed"))
        }
    }

    func testServerErrorsAreUnavailability() async {
        let transport = StubTransport()
        transport.json("GET", getFeedURL, status: 503, ["error": "InternalServerError"])

        do {
            _ = try await AppViewClient(serviceURL: appView, transport: transport).getFeed()
            XCTFail("expected an error")
        } catch {
            XCTAssertEqual(error as? ATProtoError, .serverUnavailable(.serverError(host: "appview.example.com", status: 503)))
        }
    }

    func testRejectsAResponseWithoutAFeed() async {
        let transport = StubTransport()
        transport.json("GET", getFeedURL, ["cursor": "c1"])

        do {
            _ = try await AppViewClient(serviceURL: appView, transport: transport).getFeed()
            XCTFail("expected an error")
        } catch {
            guard case .invalidResponse = error as? ATProtoError else {
                return XCTFail("unexpected error \(error)")
            }
        }
    }
}
