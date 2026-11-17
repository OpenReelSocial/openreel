import Foundation

/// `com.atproto.label.defs#label`: a labeler's claim about a record or an
/// account. The AppView attaches the labels it knows about to each post view
/// (`social.openreel.video.defs#postView.labels`); the client decides what to
/// do with them (`ModerationPolicy`).
public struct ATLabel: Codable, Sendable, Hashable {
    /// DID of the labeler, or of the author for a self-label.
    public let src: String
    /// AT-URI of the labeled record, or a DID for an account-level label.
    public let uri: String
    public let cid: String?
    /// The label value, such as `nsfw` or `!hide`.
    public let val: String
    /// `true` retracts an earlier label with the same `src` and `val`.
    public let neg: Bool?
    /// When the label was created.
    public let cts: String
    /// When the label stops applying, if ever.
    public let exp: String?

    public init(src: String, uri: String, cid: String? = nil, val: String, neg: Bool? = nil, cts: String, exp: String? = nil) {
        self.src = src
        self.uri = uri
        self.cid = cid
        self.val = val
        self.neg = neg
        self.cts = cts
        self.exp = exp
    }
}

/// `com.atproto.label.defs#selfLabels`: labels an author puts on their own
/// record, such as a content warning on a video post.
public struct SelfLabels: Codable, Sendable, Equatable {
    public static let type = "com.atproto.label.defs#selfLabels"
    /// Lexicon limits: at most 10 values, each up to 128 bytes.
    public static let maxValues = 10
    public static let maxValueBytes = 128

    public let values: [String]

    public init(values: [String]) {
        self.values = values
    }

    private enum CodingKeys: String, CodingKey {
        case type = "$type"
        case values
    }

    private struct Value: Codable {
        let val: String
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        values = try container.decode([Value].self, forKey: .values).map(\.val)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(Self.type, forKey: .type)
        try container.encode(values.map(Value.init(val:)), forKey: .values)
    }
}

/// Label values the client understands. OpenReel's vocabulary comes from the
/// project plan (§5.8.1); Bluesky's equivalents are accepted too so labels
/// from Bluesky labelers mean the same thing.
public enum LabelValue {
    /// Removes the content from view entirely. Cannot be clicked through.
    public static let hide = "!hide"
    /// Generic warning: blurs the content behind a click-through.
    public static let warn = "!warn"
    /// Applied by a PDS or AppView takedown; treated like `!hide`.
    public static let takedown = "!takedown"

    public static let nsfw = "nsfw"
    public static let graphicViolence = "graphic-violence"
    public static let misinformation = "misinformation"
    public static let spam = "spam"
    /// Cleared by automated classification. Feed generators use it to admit
    /// a post into discovery; the client shows nothing for it.
    public static let safe = "safe"

    /// Values that can never be revealed.
    static let alwaysHidden: Set<String> = [hide, takedown]

    /// The content category a value belongs to, or `nil` for system values
    /// and values the client does not know.
    public static func category(of value: String) -> ContentCategory? {
        switch value {
        case nsfw, "porn", "sexual", "nudity": .adult
        case graphicViolence, "graphic-media", "gore": .graphicViolence
        case misinformation: .misinformation
        case spam: .spam
        default: nil
        }
    }
}

/// What a label is about, which decides how the viewer's preferences apply.
public enum ContentCategory: String, CaseIterable, Codable, Sendable, Identifiable {
    case adult
    case graphicViolence
    case misinformation
    case spam

    public var id: Self { self }

    /// The label value OpenReel writes for this category.
    public var labelValue: String {
        switch self {
        case .adult: LabelValue.nsfw
        case .graphicViolence: LabelValue.graphicViolence
        case .misinformation: LabelValue.misinformation
        case .spam: LabelValue.spam
        }
    }

    /// Whether "warn" blurs the video (`true`) or only adds a badge.
    public var warnsByBlurring: Bool {
        switch self {
        case .adult, .graphicViolence: true
        case .misinformation, .spam: false
        }
    }

    /// Categories an author can put on their own post.
    public static let selfLabelable: [ContentCategory] = [.adult, .graphicViolence]
}

/// How the viewer wants content in a category treated.
public enum ContentVisibility: String, CaseIterable, Codable, Sendable, Identifiable {
    /// No blur and no badge.
    case show
    /// Blur behind a click-through, or a badge for categories that don't blur.
    case warn
    /// Leave it out of feeds.
    case hide

    public var id: Self { self }
}

/// `atproto-accept-labelers`: which labelers' labels the AppView should
/// attach. `redact` asks the AppView to drop content that labeler hides
/// (`!hide`, `!takedown`) rather than send it labeled.
public struct LabelerSubscription: Sendable, Hashable {
    public let did: String
    public let redact: Bool

    public init(did: String, redact: Bool = false) {
        self.did = did
        self.redact = redact
    }

    public static let acceptLabelersHeader = "atproto-accept-labelers"

    /// The header value, e.g. `did:plc:abc;redact, did:plc:def`, or `nil`
    /// when there are no labelers to ask for.
    public static func headerValue(_ labelers: [LabelerSubscription]) -> String? {
        guard !labelers.isEmpty else { return nil }
        return labelers.map { $0.redact ? "\($0.did);redact" : $0.did }.joined(separator: ", ")
    }
}
