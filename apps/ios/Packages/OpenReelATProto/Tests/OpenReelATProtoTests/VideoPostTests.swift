import XCTest
@testable import OpenReelATProto

final class VideoPostTests: XCTestCase {
    private let uploadURL = Fixtures.pds.appending(path: "xrpc/com.atproto.repo.uploadBlob").absoluteString
    private let createURL = Fixtures.pds.appending(path: "xrpc/com.atproto.repo.createRecord").absoluteString
    private let blobJSON: [String: Any] = [
        "$type": "blob",
        "ref": ["$link": "bafkreivideo"],
        "mimeType": "video/quicktime",
        "size": 4,
    ]

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

    func testUploadsBlobBytesWithDPoP() async throws {
        let transport = StubTransport()
        let manager = try await signedIn(transport)
        transport.json("POST", uploadURL, ["blob": blobJSON])
        let progress = Progress()

        let blob = try await manager.uploadBlob(Data([0, 1, 2, 3]), mimeType: "video/quicktime") { fraction in
            progress.completedUnitCount = Int64(fraction * 100)
        }

        XCTAssertEqual(blob, BlobRef(link: "bafkreivideo", mimeType: "video/quicktime", size: 4))
        XCTAssertEqual(progress.completedUnitCount, 100)
        let sent = try XCTUnwrap(transport.requests(matching: uploadURL).last)
        XCTAssertEqual(sent.httpMethod, "POST")
        XCTAssertEqual(sent.value(forHTTPHeaderField: "Content-Type"), "video/quicktime")
        XCTAssertEqual(sent.value(forHTTPHeaderField: "Authorization"), "DPoP access-0")
        XCTAssertNotNil(sent.value(forHTTPHeaderField: "DPoP"))
        XCTAssertEqual(sent.httpBody, Data([0, 1, 2, 3]))
    }

    func testPostsVideoRecordReferencingTheUploadedBlob() async throws {
        let transport = StubTransport()
        let manager = try await signedIn(transport)
        transport.json("POST", uploadURL, ["blob": blobJSON])
        transport.json("POST", createURL, ["uri": "at://\(Fixtures.did.rawValue)/social.openreel.video.post/3kv", "cid": "bafyreipost"])

        let output = try await manager.postVideo(
            Data([0, 1, 2, 3]),
            mimeType: "video/quicktime",
            durationMs: 3_000,
            aspectRatio: VideoAspectRatio(width: 9, height: 16),
            caption: "  sunset  ",
            tags: ["nature", "sky"],
            createdAt: Date(timeIntervalSince1970: 1_700_000_000)
        )

        XCTAssertEqual(output.uri, "at://\(Fixtures.did.rawValue)/social.openreel.video.post/3kv")
        // Upload first, then the record.
        let urls = transport.requests.map { $0.url?.absoluteString ?? "" }
        XCTAssertEqual(urls, [uploadURL, createURL])
        let sent = try body(transport.requests(matching: createURL).last)
        XCTAssertEqual(sent["repo"] as? String, Fixtures.did.rawValue)
        XCTAssertEqual(sent["collection"] as? String, "social.openreel.video.post")
        let written = try XCTUnwrap(sent["record"] as? [String: Any])
        XCTAssertEqual(written["$type"] as? String, "social.openreel.video.post")
        XCTAssertEqual(written["video"] as? NSDictionary, blobJSON as NSDictionary)
        XCTAssertEqual(written["durationMs"] as? Int, 3_000)
        XCTAssertEqual(written["aspectRatio"] as? [String: Int], ["width": 9, "height": 16])
        XCTAssertEqual(written["caption"] as? String, "sunset")
        XCTAssertEqual(written["tags"] as? [String], ["nature", "sky"])
        XCTAssertEqual(written["createdAt"] as? String, "2023-11-14T22:13:20.000Z")
        XCTAssertEqual(written.count, 7)
    }

    func testLeavesOutEmptyOptionalFields() throws {
        let record = NewVideoPostRecord(
            video: BlobRef(link: "bafkreivideo", mimeType: "video/mp4", size: 10),
            durationMs: 1, caption: nil, tags: [],
            createdAt: Date(timeIntervalSince1970: 1_700_000_000)
        )
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(record)) as? [String: Any])
        XCTAssertEqual(Set(json.keys), ["$type", "video", "durationMs", "createdAt"])
    }

    func testRejectsNonVideoWithoutSendingAnything() async throws {
        let transport = StubTransport()
        let manager = try await signedIn(transport)

        do {
            _ = try await manager.postVideo(Data([1]), mimeType: "image/png", durationMs: 1_000, aspectRatio: nil)
            XCTFail("expected unsupportedType")
        } catch VideoPostError.unsupportedType(let type) {
            XCTAssertEqual(type, "image/png")
        }
        XCTAssertTrue(transport.requests.isEmpty)
    }

    func testRejectsOversizedAndEmptyVideos() {
        XCTAssertNoThrow(try VideoPostLimits.validateVideo(size: 100_000_000, mimeType: "video/mp4"))
        XCTAssertThrowsError(try VideoPostLimits.validateVideo(size: 100_000_001, mimeType: "video/mp4")) {
            XCTAssertEqual($0 as? VideoPostError, .tooLarge(bytes: 100_000_001, limit: 100_000_000))
        }
        XCTAssertThrowsError(try VideoPostLimits.validateVideo(size: 0, mimeType: "video/mp4")) {
            XCTAssertEqual($0 as? VideoPostError, .empty)
        }
        XCTAssertThrowsError(try VideoPostLimits.validateVideo(size: 10, mimeType: "video/")) {
            XCTAssertEqual($0 as? VideoPostError, .unsupportedType("video/"))
        }
    }

    func testRejectsDetailsOverTheLexiconLimits() {
        XCTAssertThrowsError(try VideoPostLimits.validateDetails(durationMs: 0, caption: nil, tags: [])) {
            XCTAssertEqual($0 as? VideoPostError, .invalidDuration)
        }
        // 300 graphemes is fine even when each is several bytes; 301 is not.
        XCTAssertNoThrow(try VideoPostLimits.validateDetails(durationMs: 1, caption: String(repeating: "é", count: 300), tags: []))
        XCTAssertThrowsError(try VideoPostLimits.validateDetails(durationMs: 1, caption: String(repeating: "a", count: 301), tags: [])) {
            XCTAssertEqual($0 as? VideoPostError, .captionTooLong(limit: 300))
        }
        XCTAssertThrowsError(try VideoPostLimits.validateDetails(durationMs: 1, caption: nil, tags: (0..<9).map { "t\($0)" })) {
            XCTAssertEqual($0 as? VideoPostError, .tooManyTags(limit: 8))
        }
        let long = String(repeating: "x", count: 65)
        XCTAssertThrowsError(try VideoPostLimits.validateDetails(durationMs: 1, caption: nil, tags: [long])) {
            XCTAssertEqual($0 as? VideoPostError, .tagTooLong(long, limit: 64))
        }
    }

    func testServerErrorDuringUploadKeepsTheSessionAndSkipsTheRecord() async throws {
        let transport = StubTransport()
        let manager = try await signedIn(transport)
        transport.json("POST", uploadURL, status: 502, ["error": "BadGateway"])

        do {
            _ = try await manager.postVideo(Data([1, 2]), mimeType: "video/mp4", durationMs: 1_000, aspectRatio: nil)
            XCTFail("expected serverUnavailable")
        } catch ATProtoError.serverUnavailable(.serverError(_, let status)) {
            XCTAssertEqual(status, 502)
        }
        XCTAssertTrue(transport.requests(matching: createURL).isEmpty)
        let session = await manager.session
        XCTAssertNotNil(session)
    }

    func testRejectedUploadSurfacesTheXRPCError() async throws {
        let transport = StubTransport()
        let manager = try await signedIn(transport)
        transport.json("POST", uploadURL, status: 400, ["error": "BlobTooLarge", "message": "This file is too large."])

        do {
            _ = try await manager.uploadBlob(Data([1]), mimeType: "video/mp4")
            XCTFail("expected an XRPC error")
        } catch let ATProtoError.xrpc(status, error, _) {
            XCTAssertEqual(status, 400)
            XCTAssertEqual(error, "BlobTooLarge")
        }
    }

    func testAspectRatioIsReducedToLowestTerms() {
        XCTAssertEqual(VideoAspectRatio(displayWidth: 1080, displayHeight: 1920), VideoAspectRatio(width: 9, height: 16))
        XCTAssertEqual(VideoAspectRatio(displayWidth: -1920, displayHeight: 1080), VideoAspectRatio(width: 16, height: 9))
        XCTAssertEqual(VideoAspectRatio(displayWidth: 720, displayHeight: 720), VideoAspectRatio(width: 1, height: 1))
        XCTAssertNil(VideoAspectRatio(displayWidth: 0, displayHeight: 1080))
    }

    func testParsesTypedHashtags() {
        XCTAssertEqual(VideoPostLimits.tags(from: " #cats dogs,#Cats\n##sky "), ["cats", "dogs", "sky"])
        XCTAssertEqual(VideoPostLimits.tags(from: "  # "), [])
    }
}
