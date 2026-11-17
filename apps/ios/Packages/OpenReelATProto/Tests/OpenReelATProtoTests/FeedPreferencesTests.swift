import XCTest
@testable import OpenReelATProto

private func feed(_ id: String, authority: String = "openreel.social") -> FeedGeneratorView {
    FeedGeneratorView(
        uri: "at://\(authority)/social.openreel.feed.generator/\(id)",
        displayName: id.capitalized,
        rankingCriteria: "heuristic",
        weights: [RankingWeight(signal: "likes", weightBps: 10_000)]
    )
}

final class FeedPreferencesTests: XCTestCase {
    private let latest = feed("recent")
    private let popular = feed("popular")
    private let trending = feed("trending")
    private let cats = feed("cats", authority: "feeds.example.com")
    private var suggested: [FeedGeneratorView] { [latest, popular, trending] }

    func testWithNoPreferencesTheTabsAreTheAppViewsOrder() {
        XCTAssertEqual(FeedPreferences().tabs(suggested: suggested), suggested)
    }

    func testReorderedTabsKeepTheirOrderAndNewFeedsFollow() {
        var preferences = FeedPreferences()
        preferences.setTabOrder([trending.uri, latest.uri])

        let fresh = feed("fresh")
        XCTAssertEqual(
            preferences.tabs(suggested: [latest, popular, trending, fresh]).map(\.uri),
            [trending.uri, latest.uri, popular.uri, fresh.uri]
        )
    }

    func testHiddenFeedsLeaveTheTabsAndShowAgainLast() {
        var preferences = FeedPreferences()
        preferences.setTabOrder(suggested.map(\.uri))
        preferences.hide(latest.uri)

        XCTAssertEqual(preferences.tabs(suggested: suggested), [popular, trending])
        XCTAssertEqual(preferences.hiddenFeeds(suggested: suggested), [latest])

        preferences.show(latest.uri)
        XCTAssertEqual(preferences.tabs(suggested: suggested), [popular, trending, latest])
        XCTAssertEqual(preferences.hiddenFeeds(suggested: suggested), [])
    }

    func testTheLastTabCannotBeHidden() {
        var preferences = FeedPreferences()
        preferences.hide(latest.uri)
        preferences.hide(popular.uri)

        XCTAssertFalse(preferences.canHide(trending.uri, suggested: suggested))
        XCTAssertTrue(preferences.canHide(latest.uri, suggested: suggested))
    }

    func testAddedFeedsBecomeTabsAndCanBeRemoved() {
        var preferences = FeedPreferences()
        preferences.add([cats])

        XCTAssertEqual(preferences.tabs(suggested: suggested).last, cats)
        XCTAssertTrue(preferences.isAdded(cats.uri))

        preferences.remove(cats.uri)
        XCTAssertFalse(preferences.tabs(suggested: suggested).contains(cats))
    }

    func testAddingAHiddenFeedShowsItAgain() {
        var preferences = FeedPreferences()
        preferences.add([cats])
        preferences.hide(cats.uri)
        preferences.add([cats])

        XCTAssertTrue(preferences.tabs(suggested: suggested).contains(cats))
        XCTAssertEqual(preferences.added.count, 1)
    }

    func testAnAppViewFeedCannotBeRemovedOnlyHidden() {
        var preferences = FeedPreferences()
        preferences.remove(latest.uri)

        XCTAssertEqual(preferences.tabs(suggested: suggested), suggested)
    }

    func testAnAddedFeedTheAppViewAlsoOffersIsListedOnce() {
        var preferences = FeedPreferences()
        preferences.add([popular])

        XCTAssertEqual(preferences.available(suggested: suggested), suggested)
    }

    func testRoundTripsThroughJSON() throws {
        var preferences = FeedPreferences()
        preferences.setTabOrder([trending.uri])
        preferences.hide(popular.uri)
        preferences.add([cats])

        let decoded = try JSONDecoder().decode(FeedPreferences.self, from: JSONEncoder().encode(preferences))

        XCTAssertEqual(decoded, preferences)
    }
}

final class FeedGeneratorDirectoryTests: XCTestCase {
    private let describeURL = "https://feeds.example.com/xrpc/social.openreel.feed.describeFeedGenerator"

    func testReadsTheHostFromWhatAViewerMightType() {
        let inputs = [
            "feeds.example.com",
            "  Feeds.Example.COM ",
            "https://feeds.example.com/",
            "feeds.example.com.",
            "did:web:feeds.example.com",
            "at://feeds.example.com/social.openreel.feed.generator/cats",
        ]
        for input in inputs {
            XCTAssertEqual(FeedGeneratorDirectory.host(fromInput: input), "feeds.example.com", input)
        }
    }

    func testRefusesInputThatIsNotAPublicDomain() {
        let inputs = [
            "", "localhost", "feedgen", "127.0.0.1", "http://feeds.example.com",
            "feeds.example.com:8443", "printer.local", "db.internal", "-bad.example.com",
            "did:plc:alice000000000000000000000", "feeds example.com",
        ]
        for input in inputs {
            XCTAssertNil(FeedGeneratorDirectory.host(fromInput: input), input)
        }
    }

    func testKeepsOnlyFeedsTheHostServesItself() async throws {
        let transport = StubTransport()
        transport.json("GET", describeURL, ["feeds": [
            [
                "uri": "at://feeds.example.com/social.openreel.feed.generator/cats",
                "displayName": "Cats",
                "rankingCriteria": "heuristic",
                "weights": [["signal": "likes", "weightBps": 10_000]],
            ],
            [
                "uri": "at://did:web:feeds.example.com/social.openreel.feed.generator/dogs",
                "displayName": "Dogs",
                "rankingCriteria": "chronological",
            ],
            [
                "uri": "at://openreel.social/social.openreel.feed.generator/recent",
                "displayName": "Not theirs",
                "rankingCriteria": "chronological",
            ],
            ["uri": "at://feeds.example.com/social.openreel.feed.generator/broken"],
        ]])

        let result = try await FeedGeneratorDirectory(transport: transport).feeds(at: "feeds.example.com")

        XCTAssertEqual(result.host, "feeds.example.com")
        XCTAssertEqual(result.feeds.map(\.displayName), ["Cats", "Dogs"])
    }

    func testAHostServingNoFeedsOfItsOwnIsReported() async {
        let transport = StubTransport()
        transport.json("GET", describeURL, ["feeds": [[
            "uri": "at://openreel.social/social.openreel.feed.generator/recent",
            "displayName": "Latest",
            "rankingCriteria": "chronological",
        ]]])

        do {
            _ = try await FeedGeneratorDirectory(transport: transport).feeds(at: "feeds.example.com")
            XCTFail("expected noFeeds")
        } catch {
            XCTAssertEqual(error as? FeedLookupError, .noFeeds(host: "feeds.example.com"))
        }
    }

    func testInvalidInputIsRefusedWithoutARequest() async {
        let transport = StubTransport()
        do {
            _ = try await FeedGeneratorDirectory(transport: transport).feeds(at: "localhost")
            XCTFail("expected invalidDomain")
        } catch {
            XCTAssertEqual(error as? FeedLookupError, .invalidDomain("localhost"))
        }
        XCTAssertTrue(transport.requests.isEmpty)
    }
}
