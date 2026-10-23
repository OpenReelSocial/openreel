import Foundation

/// A `social.openreel.video.post` record to write. Reading posts back goes
/// through the AppView's `VideoPostRecord` instead.
public struct NewVideoPostRecord: Encodable, Sendable, Equatable {
    public static let collection = "social.openreel.video.post"

    public let video: BlobRef
    public let durationMs: Int
    public let aspectRatio: VideoAspectRatio?
    public let caption: String?
    public let tags: [String]?
    public let createdAt: Date

    public init(video: BlobRef, durationMs: Int, aspectRatio: VideoAspectRatio? = nil,
                caption: String? = nil, tags: [String]? = nil, createdAt: Date = Date()) {
        self.video = video
        self.durationMs = durationMs
        self.aspectRatio = aspectRatio
        self.caption = caption
        self.tags = tags
        self.createdAt = createdAt
    }

    private enum CodingKeys: String, CodingKey {
        case type = "$type"
        case video, durationMs, aspectRatio, caption, tags, createdAt
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(Self.collection, forKey: .type)
        try container.encode(video, forKey: .video)
        try container.encode(durationMs, forKey: .durationMs)
        try container.encodeIfPresent(aspectRatio, forKey: .aspectRatio)
        try container.encodeIfPresent(caption, forKey: .caption)
        if let tags, !tags.isEmpty {
            try container.encode(tags, forKey: .tags)
        }
        try container.encode(WatchEventRecord.datetime(createdAt), forKey: .createdAt)
    }
}

/// Why a video or its post details break the Lexicon's limits. Checked
/// before uploading, so nothing is sent that the PDS would reject.
public enum VideoPostError: Error, Equatable, Sendable {
    case empty
    case tooLarge(bytes: Int, limit: Int)
    case unsupportedType(String)
    case invalidDuration
    case captionTooLong(limit: Int)
    case tooManyTags(limit: Int)
    case tagTooLong(String, limit: Int)
}

/// The `social.openreel.video.post` Lexicon's limits.
public enum VideoPostLimits {
    /// `video.maxSize`, in bytes.
    public static let maxVideoBytes = 100_000_000
    /// `caption.maxGraphemes` and `caption.maxLength` (UTF-8 bytes).
    public static let maxCaptionGraphemes = 300
    public static let maxCaptionBytes = 3000
    /// `tags.maxLength`, and each tag's `maxGraphemes` / `maxLength`.
    public static let maxTags = 8
    public static let maxTagGraphemes = 64
    public static let maxTagBytes = 640

    /// `video.accept` is `video/*`.
    public static func accepts(mimeType: String) -> Bool {
        let lowered = mimeType.lowercased()
        return lowered.hasPrefix("video/") && lowered.count > "video/".count
    }

    public static func validateVideo(size: Int, mimeType: String) throws {
        guard accepts(mimeType: mimeType) else { throw VideoPostError.unsupportedType(mimeType) }
        guard size > 0 else { throw VideoPostError.empty }
        guard size <= maxVideoBytes else { throw VideoPostError.tooLarge(bytes: size, limit: maxVideoBytes) }
    }

    public static func validateDetails(durationMs: Int, caption: String?, tags: [String]) throws {
        guard durationMs >= 1 else { throw VideoPostError.invalidDuration }
        if let caption, caption.count > maxCaptionGraphemes || caption.utf8.count > maxCaptionBytes {
            throw VideoPostError.captionTooLong(limit: maxCaptionGraphemes)
        }
        guard tags.count <= maxTags else { throw VideoPostError.tooManyTags(limit: maxTags) }
        if let long = tags.first(where: { $0.count > maxTagGraphemes || $0.utf8.count > maxTagBytes }) {
            throw VideoPostError.tagTooLong(long, limit: maxTagGraphemes)
        }
    }

    /// Hashtags typed as free text ("#cats dogs, #cats") as the record wants
    /// them: without `#`, split on whitespace and commas, duplicates dropped.
    public static func tags(from text: String) -> [String] {
        var seen: Set<String> = []
        return text
            .split(whereSeparator: { $0.isWhitespace || $0 == "," })
            .map { $0.drop(while: { $0 == "#" }) }
            .map(String.init)
            .filter { !$0.isEmpty && seen.insert($0.lowercased()).inserted }
    }
}

extension ATProtoSessionManager {
    /// Uploads a video and publishes a `social.openreel.video.post` for it
    /// in the signed-in account's repository. Validates against the Lexicon
    /// first, so an oversized or non-video file is never sent.
    /// `uploadProgress` covers the upload, which is nearly all of the time.
    public func postVideo(
        _ data: Data,
        mimeType: String,
        durationMs: Int,
        aspectRatio: VideoAspectRatio?,
        caption: String? = nil,
        tags: [String] = [],
        createdAt: Date = Date(),
        uploadProgress: UploadProgressHandler? = nil
    ) async throws -> CreateRecordOutput {
        let caption = caption?.trimmingCharacters(in: .whitespacesAndNewlines)
        let captionOrNil = caption?.isEmpty == false ? caption : nil
        try VideoPostLimits.validateVideo(size: data.count, mimeType: mimeType)
        try VideoPostLimits.validateDetails(durationMs: durationMs, caption: captionOrNil, tags: tags)

        let blob = try await uploadBlob(data, mimeType: mimeType, uploadProgress: uploadProgress)
        let record = NewVideoPostRecord(
            video: blob, durationMs: durationMs, aspectRatio: aspectRatio,
            caption: captionOrNil, tags: tags, createdAt: createdAt
        )
        return try await createRecord(collection: NewVideoPostRecord.collection, record: record)
    }
}
