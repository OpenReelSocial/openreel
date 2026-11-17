import OpenReelATProto

/// Plain-language text for how a feed ranks, from what its generator
/// discloses (`rankingCriteria` and `weights`; project plan 3.2.1,
/// "Algorithm Selection").
enum FeedDisclosure {
    /// Names for the generator record's ranking families.
    static func criteriaName(_ criteria: String) -> String {
        switch criteria {
        case "chronological": return "Chronological: no ranking"
        case "heuristic": return "Weighted by public signals"
        case "social": return "Based on who you follow"
        case "personalized": return "Personalized from your activity"
        case "collaborative": return "Based on similar viewers"
        case "hybrid": return "Mix of methods"
        default: return criteria
        }
    }

    static func signalName(_ signal: String) -> String {
        switch signal {
        case "views": return "Views"
        case "likes": return "Likes"
        case "recency": return "Recency"
        case "completion": return "Completion"
        case "likeRatio": return "Like ratio"
        default: return signal.capitalized
        }
    }

    /// One line: the weights (`Completion 40% · Like ratio 30% · Recency 30%`)
    /// for a weighted feed, the ranking family otherwise.
    static func summary(_ feed: FeedGeneratorView) -> String {
        guard !feed.weights.isEmpty else { return criteriaName(feed.rankingCriteria) }
        return feed.weights
            .map { "\(signalName($0.signal)) \(Int(($0.fraction * 100).rounded()))%" }
            .joined(separator: " · ")
    }

    /// SF Symbol for a feed's ranking family.
    static func symbol(_ feed: FeedGeneratorView) -> String {
        switch feed.rankingCriteria {
        case "chronological": return "clock"
        case "heuristic": return "chart.line.uptrend.xyaxis"
        case "social": return "person.2"
        case "personalized": return "person.crop.circle"
        case "collaborative": return "person.3"
        default: return "square.stack.3d.up"
        }
    }
}
