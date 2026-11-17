import Foundation

/// `social.openreel.video.defs#commentView`: a comment the AppView indexed.
public struct CommentView: Decodable, Sendable, Equatable, Identifiable {
    public let uri: String
    public let cid: String
    public let author: VideoAuthorView
    /// `nil` if the record did not decode; such a comment is dropped by
    /// `CommentsPage`, since there is no text to show.
    public let record: CommentRecord?
    /// Replies, on a top-level comment. `nil` from an AppView that does not
    /// count them.
    public let replyCount: Int?
    public let indexedAt: String
    public let labels: [ATLabel]

    public var id: String { uri }

    public init(uri: String, cid: String, author: VideoAuthorView, record: CommentRecord?,
                replyCount: Int? = nil, indexedAt: String, labels: [ATLabel] = []) {
        self.uri = uri
        self.cid = cid
        self.author = author
        self.record = record
        self.replyCount = replyCount
        self.indexedAt = indexedAt
        self.labels = labels
    }

    private enum CodingKeys: String, CodingKey {
        case uri, cid, author, record, replyCount, indexedAt, labels
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        uri = try container.decode(String.self, forKey: .uri)
        cid = try container.decode(String.self, forKey: .cid)
        author = try container.decode(VideoAuthorView.self, forKey: .author)
        record = try? container.decodeIfPresent(CommentRecord.self, forKey: .record)
        replyCount = try? container.decodeIfPresent(Int.self, forKey: .replyCount)
        indexedAt = try container.decode(String.self, forKey: .indexedAt)
        labels = (try? container.decodeIfPresent([Lenient<ATLabel>].self, forKey: .labels))?
            .compactMap(\.value) ?? []
    }

    public var strongRef: StrongRef { StrongRef(uri: uri, cid: cid) }
}

/// The fields of a `social.openreel.video.comment` record the client shows.
public struct CommentRecord: Decodable, Sendable, Equatable {
    public let text: String
    public let subject: StrongRef?
    public let parent: StrongRef?
    public let createdAt: String?

    public init(text: String, subject: StrongRef? = nil, parent: StrongRef? = nil, createdAt: String? = nil) {
        self.text = text
        self.subject = subject
        self.parent = parent
        self.createdAt = createdAt
    }
}

/// One page of `social.openreel.video.getComments`. A `nil` cursor is the end.
public struct CommentsPage: Decodable, Sendable, Equatable {
    public let comments: [CommentView]
    public let cursor: String?

    public init(comments: [CommentView], cursor: String? = nil) {
        self.comments = comments
        self.cursor = cursor
    }

    private enum CodingKeys: String, CodingKey {
        case comments, cursor
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        // One malformed comment, or one without readable text, drops that
        // comment rather than the page.
        comments = try container.decode([Lenient<CommentView>].self, forKey: .comments)
            .compactMap(\.value)
            .filter { $0.record != nil }
        cursor = try container.decodeIfPresent(String.self, forKey: .cursor)
    }
}

/// A `social.openreel.video.comment` record to write.
public struct NewCommentRecord: Encodable, Sendable, Equatable {
    public static let collection = "social.openreel.video.comment"

    public let subject: StrongRef
    public let parent: StrongRef?
    public let text: String
    public let createdAt: Date

    public init(subject: StrongRef, parent: StrongRef? = nil, text: String, createdAt: Date = Date()) {
        self.subject = subject
        self.parent = parent
        self.text = text
        self.createdAt = createdAt
    }

    private enum CodingKeys: String, CodingKey {
        case type = "$type"
        case subject, parent, text, createdAt
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(Self.collection, forKey: .type)
        try container.encode(subject, forKey: .subject)
        try container.encodeIfPresent(parent, forKey: .parent)
        try container.encode(text, forKey: .text)
        try container.encode(WatchEventRecord.datetime(createdAt), forKey: .createdAt)
    }
}

/// Why a comment can't be posted as written.
public enum CommentError: Error, Equatable, Sendable {
    case empty
    case tooLong(limit: Int)
}

/// The `social.openreel.video.comment` Lexicon's limits.
public enum CommentLimits {
    public static let maxGraphemes = 300
    public static let maxBytes = 3000

    /// The text as it will be posted (trimmed), or why it can't be.
    public static func validate(_ text: String) throws -> String {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw CommentError.empty }
        guard trimmed.count <= maxGraphemes, trimmed.utf8.count <= maxBytes else {
            throw CommentError.tooLong(limit: maxGraphemes)
        }
        return trimmed
    }
}

extension AppViewClient {
    public static let getCommentsNSID = "social.openreel.video.getComments"

    /// One page of a video's top-level comments, or with `parent` the
    /// replies to one of them.
    public func getComments(on postURI: String, parent: String? = nil, limit: Int? = nil,
                            cursor: String? = nil) async throws -> CommentsPage {
        var parameters = ["uri": postURI]
        if let parent { parameters["parent"] = parent }
        if let limit { parameters["limit"] = String(limit) }
        if let cursor { parameters["cursor"] = cursor }
        return try await query(Self.getCommentsNSID, parameters: parameters, as: CommentsPage.self)
    }
}

extension ATProtoSessionManager {
    /// Publishes a comment on `post` in the signed-in account's repository.
    /// `parent` is the top-level comment a reply belongs to.
    public func postComment(_ text: String, on post: StrongRef, parent: StrongRef? = nil,
                            createdAt: Date = Date()) async throws -> CreateRecordOutput {
        let text = try CommentLimits.validate(text)
        let record = NewCommentRecord(subject: post, parent: parent, text: text, createdAt: createdAt)
        return try await createRecord(collection: NewCommentRecord.collection, record: record)
    }

    /// Deletes one of the signed-in account's comments by its AT-URI.
    public func deleteComment(uri: String) async throws {
        guard let rkey = uri.split(separator: "/").last, uri.contains("/\(NewCommentRecord.collection)/") else {
            throw ATProtoError.invalidResponse("not a comment URI: \(uri)")
        }
        try await deleteRecord(collection: NewCommentRecord.collection, rkey: String(rkey))
    }
}
