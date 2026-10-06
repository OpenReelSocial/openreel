import Foundation

/// `social.openreel.video.defs#postView`: a video post the AppView has
/// hydrated with playable media. `playlist` and `thumbnail` point at the media
/// pipeline's renditions, not at the author's PDS.
public struct VideoPostView: Decodable, Sendable, Equatable, Identifiable {
    public let uri: String
    public let cid: String
    public let author: VideoAuthorView
    /// The `social.openreel.video.post` record, or `nil` if it did not decode.
    /// The Lexicon types it as `unknown`, so a record written by a newer
    /// client must not make the whole feed page unreadable.
    public let record: VideoPostRecord?
    public let playlist: URL
    public let thumbnail: URL?
    public let aspectRatio: VideoAspectRatio?
    public let durationMs: Int?
    public let indexedAt: String

    public var id: String { uri }

    public init(
        uri: String,
        cid: String,
        author: VideoAuthorView,
        record: VideoPostRecord?,
        playlist: URL,
        thumbnail: URL? = nil,
        aspectRatio: VideoAspectRatio? = nil,
        durationMs: Int? = nil,
        indexedAt: String
    ) {
        self.uri = uri
        self.cid = cid
        self.author = author
        self.record = record
        self.playlist = playlist
        self.thumbnail = thumbnail
        self.aspectRatio = aspectRatio
        self.durationMs = durationMs
        self.indexedAt = indexedAt
    }

    private enum CodingKeys: String, CodingKey {
        case uri, cid, author, record, playlist, thumbnail, aspectRatio, durationMs, indexedAt
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        uri = try container.decode(String.self, forKey: .uri)
        cid = try container.decode(String.self, forKey: .cid)
        author = try container.decode(VideoAuthorView.self, forKey: .author)
        record = try? container.decodeIfPresent(VideoPostRecord.self, forKey: .record)
        playlist = try container.decode(URL.self, forKey: .playlist)
        thumbnail = try? container.decodeIfPresent(URL.self, forKey: .thumbnail)
        aspectRatio = try? container.decodeIfPresent(VideoAspectRatio.self, forKey: .aspectRatio)
        durationMs = try? container.decodeIfPresent(Int.self, forKey: .durationMs)
        indexedAt = try container.decode(String.self, forKey: .indexedAt)
    }
}

/// `social.openreel.video.defs#authorView`.
public struct VideoAuthorView: Decodable, Sendable, Equatable {
    public let did: String
    /// Claimed in the author's DID document; the AppView does not verify it yet.
    public let handle: String?

    public init(did: String, handle: String? = nil) {
        self.did = did
        self.handle = handle
    }
}

/// `social.openreel.video.post#aspectRatio`. Only the ratio is meaningful.
public struct VideoAspectRatio: Decodable, Sendable, Equatable {
    public let width: Int
    public let height: Int

    public init(width: Int, height: Int) {
        self.width = width
        self.height = height
    }

    /// Width over height, or `nil` for a ratio with a non-positive side.
    public var value: Double? {
        guard width > 0, height > 0 else { return nil }
        return Double(width) / Double(height)
    }
}

/// The display fields of a `social.openreel.video.post` record. Blob refs and
/// self-labels are left out until the client has a use for them.
public struct VideoPostRecord: Decodable, Sendable, Equatable {
    public let caption: String?
    public let tags: [String]?
    public let alt: String?
    public let durationMs: Int?
    public let createdAt: String?

    public init(caption: String? = nil, tags: [String]? = nil, alt: String? = nil, durationMs: Int? = nil, createdAt: String? = nil) {
        self.caption = caption
        self.tags = tags
        self.alt = alt
        self.durationMs = durationMs
        self.createdAt = createdAt
    }
}

/// One page of `social.openreel.feed.getFeed`. A `nil` cursor is the end of
/// the feed.
public struct VideoFeedPage: Decodable, Sendable, Equatable {
    public let feed: [VideoPostView]
    public let cursor: String?

    public init(feed: [VideoPostView], cursor: String? = nil) {
        self.feed = feed
        self.cursor = cursor
    }

    private enum CodingKeys: String, CodingKey {
        case feed, cursor
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        // Decode posts one at a time so one malformed view drops that post,
        // not the page.
        var items = try container.nestedUnkeyedContainer(forKey: .feed)
        var posts: [VideoPostView] = []
        while !items.isAtEnd {
            if let post = try? items.decode(VideoPostView.self) {
                posts.append(post)
            } else {
                _ = try items.decode(Skip.self)
            }
        }
        feed = posts
        cursor = try container.decodeIfPresent(String.self, forKey: .cursor)
    }

    /// Consumes one array element of any shape.
    private struct Skip: Decodable {
        init(from decoder: Decoder) throws {}
    }
}

/// Unauthenticated reads from an OpenReel AppView. `getFeed` is public data,
/// so it does not go through the session manager.
public struct AppViewClient: Sendable {
    public static let getFeedNSID = "social.openreel.feed.getFeed"

    private let xrpc: XRPCClient

    public init(serviceURL: URL, transport: any HTTPTransport = URLSessionTransport()) {
        self.xrpc = XRPCClient(serviceURL: serviceURL, transport: transport)
    }

    public var serviceURL: URL { xrpc.serviceURL }

    /// One page of hydrated, playable posts. `feed` is a generator record's
    /// AT-URI; `nil` asks for the AppView's default feed. Posts whose media is
    /// not ready are omitted by the AppView, so a page can be shorter than
    /// `limit` (even empty) and still have a cursor.
    public func getFeed(feed: String? = nil, limit: Int? = nil, cursor: String? = nil) async throws -> VideoFeedPage {
        var parameters: [String: String] = [:]
        if let feed { parameters["feed"] = feed }
        if let limit { parameters["limit"] = String(limit) }
        if let cursor { parameters["cursor"] = cursor }
        return try await xrpc.query(Self.getFeedNSID, parameters: parameters, as: VideoFeedPage.self)
    }
}
