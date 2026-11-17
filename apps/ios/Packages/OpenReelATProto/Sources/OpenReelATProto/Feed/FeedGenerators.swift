import Foundation

/// `social.openreel.feed.defs#generatorView`: a feed the viewer can pick, with
/// how it ranks disclosed.
public struct FeedGeneratorView: Codable, Sendable, Equatable, Identifiable {
    /// The generator record's AT-URI; pass it as `getFeed`'s `feed`.
    public let uri: String
    public let displayName: String
    public let description: String?
    /// Ranking family, e.g. `chronological` or `heuristic`. An open set.
    public let rankingCriteria: String
    /// The signals a weighted feed sums; empty for other feeds.
    public let weights: [RankingWeight]

    public var id: String { uri }

    /// The feed URI's authority, lower-cased: `feeds.example.com` for
    /// `at://feeds.example.com/social.openreel.feed.generator/cats`.
    public var authority: String? {
        guard uri.hasPrefix("at://") else { return nil }
        let rest = uri.dropFirst("at://".count)
        guard let slash = rest.firstIndex(of: "/"), slash > rest.startIndex else { return nil }
        return rest[..<slash].lowercased()
    }

    public init(uri: String, displayName: String, description: String? = nil, rankingCriteria: String, weights: [RankingWeight] = []) {
        self.uri = uri
        self.displayName = displayName
        self.description = description
        self.rankingCriteria = rankingCriteria
        self.weights = weights
    }

    private enum CodingKeys: String, CodingKey {
        case uri, displayName, description, rankingCriteria, weights
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        uri = try container.decode(String.self, forKey: .uri)
        displayName = try container.decode(String.self, forKey: .displayName)
        description = try? container.decodeIfPresent(String.self, forKey: .description)
        rankingCriteria = try container.decode(String.self, forKey: .rankingCriteria)
        // Weights are disclosure, not needed to play the feed: a shape this
        // client does not understand hides them rather than the feed.
        weights = (try? container.decodeIfPresent([RankingWeight].self, forKey: .weights)) ?? []
    }

    /// Same shape as the Lexicon, so a saved feed decodes like a fetched one.
    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(uri, forKey: .uri)
        try container.encode(displayName, forKey: .displayName)
        try container.encodeIfPresent(description, forKey: .description)
        try container.encode(rankingCriteria, forKey: .rankingCriteria)
        if !weights.isEmpty {
            try container.encode(weights, forKey: .weights)
        }
    }
}

/// `social.openreel.feed.defs#rankingWeight`: one term of a weighted score.
public struct RankingWeight: Codable, Sendable, Equatable {
    /// `views`, `likes`, or `recency` today; an open set.
    public let signal: String
    /// Share of the score in basis points (0-10000).
    public let weightBps: Int
    /// For time-decayed signals: hours for the signal to halve.
    public let halfLifeHours: Int?

    public init(signal: String, weightBps: Int, halfLifeHours: Int? = nil) {
        self.signal = signal
        self.weightBps = weightBps
        self.halfLifeHours = halfLifeHours
    }

    /// Share of the score, 0-1.
    public var fraction: Double { Double(weightBps) / 10_000 }
}

/// Output of `social.openreel.feed.getSuggestedFeeds`.
struct SuggestedFeedsOutput: Decodable {
    let feeds: [FeedGeneratorView]
}

/// Output of `social.openreel.feed.describeFeedGenerator`. One feed this
/// client cannot read drops that feed, not the whole list.
struct DescribeFeedGeneratorOutput: Decodable {
    let feeds: [FeedGeneratorView]

    private enum CodingKeys: String, CodingKey { case feeds }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        feeds = try container.decode([Lenient<FeedGeneratorView>].self, forKey: .feeds).compactMap(\.value)
    }
}
