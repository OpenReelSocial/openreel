import Foundation

/// One label that applies to a post, after retractions and expiry.
public struct ModerationCause: Sendable, Hashable {
    public let value: String
    /// DID of the labeler, or the author's DID for a self-label.
    public let source: String
    public let isSelfLabel: Bool
    /// The label is on the author's account rather than this post.
    public let isAccountLabel: Bool

    public init(value: String, source: String, isSelfLabel: Bool = false, isAccountLabel: Bool = false) {
        self.value = value
        self.source = source
        self.isSelfLabel = isSelfLabel
        self.isAccountLabel = isAccountLabel
    }

    public var category: ContentCategory? { LabelValue.category(of: value) }
}

/// What the client should do with a post.
public struct ModerationDecision: Sendable, Equatable {
    /// Leave the post out of feeds.
    public var isHidden = false
    /// Causes that blur the post behind a click-through. Empty means no blur.
    public var coverCauses: [ModerationCause] = []
    /// Causes shown as small labels on the post without blurring it.
    public var badges: [ModerationCause] = []

    public init(isHidden: Bool = false, coverCauses: [ModerationCause] = [], badges: [ModerationCause] = []) {
        self.isHidden = isHidden
        self.coverCauses = coverCauses
        self.badges = badges
    }

    public var isCovered: Bool { !isHidden && !coverCauses.isEmpty }

    public static let none = ModerationDecision()
}

/// The viewer's choice for each category. Missing categories use the
/// defaults from the project plan: adult content and graphic violence are
/// blurred, misinformation and spam are badged.
public struct ModerationPreferences: Sendable, Equatable, Codable {
    public var visibility: [ContentCategory: ContentVisibility]

    public init(visibility: [ContentCategory: ContentVisibility] = [:]) {
        self.visibility = visibility
    }

    public static let `default` = ModerationPreferences()

    public subscript(category: ContentCategory) -> ContentVisibility {
        get { visibility[category] ?? .warn }
        set { visibility[category] = newValue }
    }
}

/// Turns the labels on a post into what the viewer sees. Pure, so the same
/// inputs always give the same decision.
public enum ModerationPolicy {
    /// The labels that currently apply to a post: the AppView's labels for
    /// the post or its author, minus retracted and expired ones, plus the
    /// author's self-labels. One cause per source and value.
    public static func causes(
        labels: [ATLabel],
        selfLabels: [String],
        postURI: String,
        authorDID: String,
        now: Date = Date()
    ) -> [ModerationCause] {
        // Oldest first, so a later retraction (neg) cancels an earlier label
        // and a later re-application restores it.
        let ordered = labels
            .filter { $0.uri == postURI || $0.uri == authorDID }
            .sorted { (date($0.cts) ?? .distantPast) < (date($1.cts) ?? .distantPast) }

        struct Key: Hashable { let src, val, uri: String }
        var active: [Key: ATLabel] = [:]
        var order: [Key] = []
        for label in ordered {
            let key = Key(src: label.src, val: label.val, uri: label.uri)
            if label.neg == true {
                active[key] = nil
            } else {
                if active[key] == nil, !order.contains(key) { order.append(key) }
                active[key] = label
            }
        }

        var causes: [ModerationCause] = []
        var seen: Set<String> = []
        for key in order {
            guard let label = active[key] else { continue }
            if let exp = label.exp.flatMap(date), exp <= now { continue }
            guard seen.insert("\(label.src)|\(label.val)").inserted else { continue }
            causes.append(ModerationCause(
                value: label.val,
                source: label.src,
                isSelfLabel: label.src == authorDID,
                isAccountLabel: label.uri == authorDID
            ))
        }
        for value in selfLabels where seen.insert("\(authorDID)|\(value)").inserted {
            causes.append(ModerationCause(value: value, source: authorDID, isSelfLabel: true))
        }
        return causes
    }

    public static func decide(_ causes: [ModerationCause], preferences: ModerationPreferences) -> ModerationDecision {
        var decision = ModerationDecision()
        for cause in causes {
            if LabelValue.alwaysHidden.contains(cause.value) {
                // An author cannot hide their own post from themselves this way.
                if !cause.isSelfLabel { decision.isHidden = true }
                continue
            }
            if cause.value == LabelValue.warn {
                decision.coverCauses.append(cause)
                continue
            }
            guard let category = cause.category else { continue }
            switch preferences[category] {
            case .hide:
                decision.isHidden = true
            case .warn:
                if category.warnsByBlurring {
                    decision.coverCauses.append(cause)
                } else {
                    decision.badges.append(cause)
                }
            case .show:
                break
            }
        }
        return decision
    }

    private static func date(_ string: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: string) { return date }
        return ISO8601DateFormatter().date(from: string)
    }
}
