import XCTest
@testable import OpenReelATProto

final class ModerationTests: XCTestCase {
    private let post = "at://did:plc:author/social.openreel.video.post/1"
    private let author = "did:plc:author"
    private let labeler = "did:plc:labeler"

    private func label(_ val: String, src: String? = nil, uri: String? = nil, neg: Bool? = nil,
                       cts: String = "2026-11-01T00:00:00.000Z", exp: String? = nil) -> ATLabel {
        ATLabel(src: src ?? labeler, uri: uri ?? post, val: val, neg: neg, cts: cts, exp: exp)
    }

    private func causes(_ labels: [ATLabel], selfLabels: [String] = [], now: Date = Date()) -> [ModerationCause] {
        ModerationPolicy.causes(labels: labels, selfLabels: selfLabels, postURI: post, authorDID: author, now: now)
    }

    // MARK: - Which labels apply

    func testRetractionCancelsAnEarlierLabel() {
        let result = causes([
            label("nsfw", cts: "2026-11-01T00:00:00.000Z"),
            label("nsfw", neg: true, cts: "2026-11-02T00:00:00.000Z"),
        ])
        XCTAssertEqual(result, [])
    }

    func testReapplyingAfterRetractionRestoresTheLabel() {
        let result = causes([
            label("nsfw", cts: "2026-11-03T00:00:00.000Z"),
            label("nsfw", neg: true, cts: "2026-11-02T00:00:00.000Z"),
            label("nsfw", cts: "2026-11-01T00:00:00.000Z"),
        ])
        XCTAssertEqual(result.map(\.value), ["nsfw"])
    }

    func testExpiredLabelsAndOtherSubjectsAreIgnored() {
        let now = ISO8601DateFormatter().date(from: "2026-11-10T00:00:00Z")!
        let result = causes([
            label("spam", exp: "2026-11-05T00:00:00.000Z"),
            label("misinformation", exp: "2026-12-01T00:00:00.000Z"),
            label("nsfw", uri: "at://did:plc:someone/social.openreel.video.post/9"),
        ], now: now)
        XCTAssertEqual(result.map(\.value), ["misinformation"])
    }

    func testAccountLabelsAndSelfLabelsApply() {
        let result = causes([label("spam", uri: author)], selfLabels: ["graphic-violence"])
        XCTAssertEqual(result, [
            ModerationCause(value: "spam", source: labeler, isAccountLabel: true),
            ModerationCause(value: "graphic-violence", source: author, isSelfLabel: true),
        ])
    }

    func testSelfLabelEchoedByTheAppViewIsNotDuplicated() {
        let result = causes([label("nsfw", src: author)], selfLabels: ["nsfw"])
        XCTAssertEqual(result, [ModerationCause(value: "nsfw", source: author, isSelfLabel: true)])
    }

    // MARK: - Decisions

    func testDefaultsBlurAdultAndViolenceAndBadgeTheRest() {
        let decision = ModerationPolicy.decide(causes([
            label("nsfw"), label("graphic-violence"), label("misinformation"), label("spam"), label("safe"),
        ]), preferences: .default)
        XCTAssertFalse(decision.isHidden)
        XCTAssertTrue(decision.isCovered)
        XCTAssertEqual(decision.coverCauses.map(\.value), ["nsfw", "graphic-violence"])
        XCTAssertEqual(decision.badges.map(\.value), ["misinformation", "spam"])
    }

    func testPreferencesHideOrShowACategory() {
        var preferences = ModerationPreferences.default
        preferences[.adult] = .show
        preferences[.spam] = .hide
        XCTAssertEqual(ModerationPolicy.decide(causes([label("porn")]), preferences: preferences), .none)
        XCTAssertTrue(ModerationPolicy.decide(causes([label("spam")]), preferences: preferences).isHidden)
    }

    func testHideAndTakedownAlwaysHideButNotAsSelfLabels() {
        XCTAssertTrue(ModerationPolicy.decide(causes([label("!hide")]), preferences: .default).isHidden)
        XCTAssertTrue(ModerationPolicy.decide(causes([label("!takedown")]), preferences: .default).isHidden)
        XCTAssertFalse(ModerationPolicy.decide(causes([], selfLabels: ["!hide"]), preferences: .default).isHidden)
    }

    func testGenericWarnBlursRegardlessOfPreferences() {
        var preferences = ModerationPreferences.default
        for category in ContentCategory.allCases { preferences[category] = .show }
        let decision = ModerationPolicy.decide(causes([label("!warn")]), preferences: preferences)
        XCTAssertEqual(decision.coverCauses.map(\.value), ["!warn"])
    }

    func testUnknownLabelsDoNothing() {
        XCTAssertEqual(ModerationPolicy.decide(causes([label("something-new")]), preferences: .default), .none)
    }

    // MARK: - Wire formats

    func testPostViewDecodesLabelsAndSelfLabels() throws {
        let json = """
        {"uri": "\(post)", "cid": "bafy", "author": {"did": "\(author)"},
         "record": {"caption": "hi", "labels": {"$type": "com.atproto.label.defs#selfLabels", "values": [{"val": "nsfw"}]}},
         "playlist": "https://media.example.com/a.m3u8", "indexedAt": "2026-11-01T00:00:00.000Z",
         "labels": [{"src": "\(labeler)", "uri": "\(post)", "val": "spam", "cts": "2026-11-01T00:00:00.000Z"}, {"bogus": true}]}
        """
        let view = try JSONDecoder().decode(VideoPostView.self, from: Data(json.utf8))
        XCTAssertEqual(view.labels.map(\.val), ["spam"])
        XCTAssertEqual(view.record?.selfLabels, ["nsfw"])
        XCTAssertEqual(view.record?.caption, "hi")
    }

    func testPostViewWithoutLabelsStillDecodes() throws {
        let json = """
        {"uri": "\(post)", "cid": "bafy", "author": {"did": "\(author)"}, "record": {"caption": "hi"},
         "playlist": "https://media.example.com/a.m3u8", "indexedAt": "2026-11-01T00:00:00.000Z"}
        """
        let view = try JSONDecoder().decode(VideoPostView.self, from: Data(json.utf8))
        XCTAssertEqual(view.labels, [])
        XCTAssertEqual(view.record?.selfLabels, [])
    }

    func testNewPostEncodesSelfLabels() throws {
        let record = NewVideoPostRecord(
            video: BlobRef(link: "bafkrei", mimeType: "video/mp4", size: 1), durationMs: 1000,
            selfLabels: ["nsfw"], createdAt: Date(timeIntervalSince1970: 0)
        )
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(record)) as? [String: Any])
        let labels = try XCTUnwrap(object["labels"] as? [String: Any])
        XCTAssertEqual(labels["$type"] as? String, "com.atproto.label.defs#selfLabels")
        XCTAssertEqual((labels["values"] as? [[String: String]])?.first?["val"], "nsfw")

        let unlabeled = NewVideoPostRecord(video: BlobRef(link: "bafkrei", mimeType: "video/mp4", size: 1), durationMs: 1000)
        let plain = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(unlabeled)) as? [String: Any])
        XCTAssertNil(plain["labels"])
    }

    func testTooManySelfLabelsAreRejected() {
        XCTAssertThrowsError(try VideoPostLimits.validateDetails(
            durationMs: 1000, caption: nil, tags: [], selfLabels: (0...10).map { "l\($0)" }
        ))
    }

    func testGetFeedAsksForSubscribedLabelers() async throws {
        let transport = StubTransport()
        let service = URL(string: "https://appview.example.com")!
        transport.json("GET", service.absoluteString, ["feed": []])
        let client = AppViewClient(
            serviceURL: service,
            labelers: [LabelerSubscription(did: labeler, redact: true), LabelerSubscription(did: "did:plc:other")],
            transport: transport
        )
        _ = try await client.getFeed()
        let sent = try XCTUnwrap(transport.requests.last)
        XCTAssertEqual(sent.value(forHTTPHeaderField: "atproto-accept-labelers"), "\(labeler);redact, did:plc:other")

        let plain = AppViewClient(serviceURL: service, transport: transport)
        _ = try await plain.getFeed()
        XCTAssertNil(transport.requests.last?.value(forHTTPHeaderField: "atproto-accept-labelers"))
    }

    // MARK: - Reports

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

    func testReportsAPostThroughThePDSProxiedToTheLabeler() async throws {
        let transport = StubTransport()
        let manager = try await signedIn(transport)
        let url = Fixtures.pds.appending(path: "xrpc/com.atproto.moderation.createReport").absoluteString
        transport.json("POST", url, ["id": 42, "reasonType": ReportReason.spam.rawValue, "createdAt": "2026-11-16T00:00:00.000Z"])

        let output = try await manager.createReport(
            subject: .record(StrongRef(uri: post, cid: "bafy")),
            reason: .spam,
            details: "  same clip posted 40 times  ",
            labeler: labeler
        )

        XCTAssertEqual(output.id, 42)
        let sent = try XCTUnwrap(transport.requests(matching: url).last)
        XCTAssertEqual(sent.value(forHTTPHeaderField: "atproto-proxy"), "\(labeler)#atproto_labeler")
        XCTAssertEqual(sent.value(forHTTPHeaderField: "Authorization"), "DPoP access-0")
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(sent.httpBody)) as? [String: Any])
        XCTAssertEqual(body["reasonType"] as? String, "com.atproto.moderation.defs#reasonSpam")
        XCTAssertEqual(body["reason"] as? String, "same clip posted 40 times")
        let subject = try XCTUnwrap(body["subject"] as? [String: String])
        XCTAssertEqual(subject, ["$type": "com.atproto.repo.strongRef", "uri": post, "cid": "bafy"])
    }

    func testReportsAnAccountWithoutAProxyWhenNoLabelerIsConfigured() async throws {
        let transport = StubTransport()
        let manager = try await signedIn(transport)
        let url = Fixtures.pds.appending(path: "xrpc/com.atproto.moderation.createReport").absoluteString
        transport.json("POST", url, ["id": 7])

        _ = try await manager.createReport(subject: .account(did: author), reason: .other)

        let sent = try XCTUnwrap(transport.requests(matching: url).last)
        XCTAssertNil(sent.value(forHTTPHeaderField: "atproto-proxy"))
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(sent.httpBody)) as? [String: Any])
        XCTAssertNil(body["reason"])
        XCTAssertEqual(body["subject"] as? [String: String], ["$type": "com.atproto.admin.defs#repoRef", "did": author])
    }

    func testReportSurfacesServerErrors() async throws {
        let transport = StubTransport()
        let manager = try await signedIn(transport)
        let url = Fixtures.pds.appending(path: "xrpc/com.atproto.moderation.createReport").absoluteString
        transport.json("POST", url, status: 400, ["error": "InvalidRequest", "message": "No moderation service configured"])

        do {
            _ = try await manager.createReport(subject: .account(did: author), reason: .other)
            XCTFail("expected an error")
        } catch let ATProtoError.xrpc(status, error, _) {
            XCTAssertEqual(status, 400)
            XCTAssertEqual(error, "InvalidRequest")
        }
    }
}
