import Foundation

/// `com.atproto.repo.strongRef`: a record pinned to one version.
public struct StrongRef: Codable, Sendable, Equatable {
    public let uri: String
    public let cid: String

    public init(uri: String, cid: String) {
        self.uri = uri
        self.cid = cid
    }
}

/// `social.openreel.engagement.watchEvent`: one watch session of a video,
/// written to the viewer's own repository. Repositories are public, so
/// writing one publishes it; only write with the viewer's consent.
public struct WatchEventRecord: Encodable, Sendable, Equatable {
    public static let collection = "social.openreel.engagement.watchEvent"

    public let subject: StrongRef
    /// Playback across the session, rewatches included.
    public let watchDurationMs: Int
    public let videoDurationMs: Int
    public let soundEnabled: Bool?
    public let rewatchCount: Int?
    /// `feed`, `profile`, `search`, or `direct`.
    public let context: String?
    public let createdAt: Date

    public init(subject: StrongRef, watchDurationMs: Int, videoDurationMs: Int, soundEnabled: Bool? = nil,
                rewatchCount: Int? = nil, context: String? = nil, createdAt: Date = Date()) {
        self.subject = subject
        self.watchDurationMs = watchDurationMs
        self.videoDurationMs = videoDurationMs
        self.soundEnabled = soundEnabled
        self.rewatchCount = rewatchCount
        self.context = context
        self.createdAt = createdAt
    }

    private enum CodingKeys: String, CodingKey {
        case type = "$type"
        case subject, watchDurationMs, videoDurationMs, soundEnabled, rewatchCount, context, createdAt
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(Self.collection, forKey: .type)
        try container.encode(subject, forKey: .subject)
        try container.encode(watchDurationMs, forKey: .watchDurationMs)
        try container.encode(videoDurationMs, forKey: .videoDurationMs)
        try container.encodeIfPresent(soundEnabled, forKey: .soundEnabled)
        try container.encodeIfPresent(rewatchCount, forKey: .rewatchCount)
        try container.encodeIfPresent(context, forKey: .context)
        try container.encode(Self.datetime(createdAt), forKey: .createdAt)
    }

    /// Lexicon `datetime`: RFC 3339 with a timezone; milliseconds as other
    /// atproto clients write them.
    static func datetime(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }
}

/// Output of `com.atproto.repo.createRecord`.
public struct CreateRecordOutput: Decodable, Sendable, Equatable {
    public let uri: String
    public let cid: String
}

private struct CreateRecordInput<Record: Encodable>: Encodable {
    let repo: String
    let collection: String
    let record: Record
}

extension ATProtoSessionManager {
    public static let createRecordNSID = "com.atproto.repo.createRecord"

    /// Writes `record` to the signed-in account's repository with a
    /// server-assigned record key.
    public func createRecord<Record: Encodable & Sendable>(collection: String, record: Record) async throws -> CreateRecordOutput {
        guard let session else { throw ATProtoError.notSignedIn }
        let input = CreateRecordInput(repo: session.did.rawValue, collection: collection, record: record)
        return try await procedure(Self.createRecordNSID, input: input, as: CreateRecordOutput.self)
    }
}
