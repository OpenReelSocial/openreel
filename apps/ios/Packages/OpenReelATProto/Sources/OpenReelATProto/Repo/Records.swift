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

/// `social.openreel.engagement.like`: the signed-in account likes a video.
/// Written to the liker's own repository; deleting the record unlikes.
/// Repositories are public, so a like is visible to anyone.
public struct LikeRecord: Encodable, Sendable, Equatable {
    public static let collection = "social.openreel.engagement.like"

    public let subject: StrongRef
    public let createdAt: Date

    public init(subject: StrongRef, createdAt: Date = Date()) {
        self.subject = subject
        self.createdAt = createdAt
    }

    private enum CodingKeys: String, CodingKey {
        case type = "$type"
        case subject, createdAt
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(Self.collection, forKey: .type)
        try container.encode(subject, forKey: .subject)
        try container.encode(WatchEventRecord.datetime(createdAt), forKey: .createdAt)
    }
}

/// The `subject` of a record that points at another, such as a like or a
/// watch event; enough to read them back without the rest of the record.
public struct RecordSubject: Decodable, Sendable, Equatable {
    public let subject: StrongRef

    public init(subject: StrongRef) {
        self.subject = subject
    }
}

/// One record from `com.atproto.repo.listRecords`.
public struct RepoRecord<Value: Decodable & Sendable>: Decodable, Sendable {
    public let uri: String
    public let cid: String
    /// `nil` if the record did not decode as `Value`; another client may
    /// have written it, and one odd record must not hide the rest.
    public let value: Value?

    private enum CodingKeys: String, CodingKey {
        case uri, cid, value
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        uri = try container.decode(String.self, forKey: .uri)
        cid = try container.decode(String.self, forKey: .cid)
        value = try? container.decode(Value.self, forKey: .value)
    }
}

/// Output of `com.atproto.repo.listRecords`. A `nil` cursor is the last page.
public struct ListRecordsOutput<Value: Decodable & Sendable>: Decodable, Sendable {
    public let records: [RepoRecord<Value>]
    public let cursor: String?
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

private struct DeleteRecordInput: Encodable {
    let repo: String
    let collection: String
    let rkey: String
}

extension ATProtoSessionManager {
    public static let createRecordNSID = "com.atproto.repo.createRecord"
    public static let deleteRecordNSID = "com.atproto.repo.deleteRecord"
    public static let listRecordsNSID = "com.atproto.repo.listRecords"

    /// Writes `record` to the signed-in account's repository with a
    /// server-assigned record key.
    public func createRecord<Record: Encodable & Sendable>(collection: String, record: Record) async throws -> CreateRecordOutput {
        guard let session else { throw ATProtoError.notSignedIn }
        let input = CreateRecordInput(repo: session.did.rawValue, collection: collection, record: record)
        return try await procedure(Self.createRecordNSID, input: input, as: CreateRecordOutput.self)
    }

    /// Deletes the record at `collection`/`rkey` from the signed-in account's
    /// repository. Deleting a record that does not exist succeeds.
    public func deleteRecord(collection: String, rkey: String) async throws {
        guard let session else { throw ATProtoError.notSignedIn }
        let input = DeleteRecordInput(repo: session.did.rawValue, collection: collection, rkey: rkey)
        let request = try XRPC.procedureRequest(service: session.pdsURL, nsid: Self.deleteRecordNSID, input: input)
        // The output (the new commit) is optional in the Lexicon; only success matters.
        try XRPC.ensureSuccess(try await authorizedSend(request))
    }

    /// One page of the signed-in account's records in `collection`, newest first.
    public func listRecords<Value: Decodable & Sendable>(
        collection: String,
        as type: Value.Type,
        limit: Int = 100,
        cursor: String? = nil
    ) async throws -> ListRecordsOutput<Value> {
        guard let session else { throw ATProtoError.notSignedIn }
        var parameters = ["repo": session.did.rawValue, "collection": collection, "limit": String(limit)]
        if let cursor { parameters["cursor"] = cursor }
        return try await query(Self.listRecordsNSID, parameters: parameters, as: ListRecordsOutput<Value>.self)
    }
}
