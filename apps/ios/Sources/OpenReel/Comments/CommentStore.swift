import Foundation
import Observation
import OpenReelATProto

/// What a comment section needs; builds one `CommentStore` per reel opened.
struct CommentsFactory {
    let appView: AppViewClient
    let auth: AuthController
    let moderation: ModerationController

    @MainActor
    func store(for reel: Reel) -> CommentStore {
        CommentStore(reel: reel, appView: appView, auth: auth, moderation: moderation)
    }
}

/// One row in the comments sheet: a comment the AppView returned, or one the
/// viewer just wrote that the AppView may not have indexed yet.
struct CommentItem: Identifiable, Hashable {
    /// The comment's AT-URI, or a local ID while it is being posted.
    let id: String
    let cid: String?
    let authorDID: String
    let authorHandle: String
    let text: String
    let createdAt: Date?
    /// The top-level comment this replies to; `nil` for a top-level comment.
    let parentURI: String?
    var replyCount: Int
    let moderationCauses: [ModerationCause]
    var state: State = .posted

    enum State: Hashable {
        case posted
        case sending
        case failed(String)
    }

    var strongRef: StrongRef? { cid.map { StrongRef(uri: id, cid: $0) } }

    init(view: CommentView) {
        id = view.uri
        cid = view.cid
        authorDID = view.author.did
        authorHandle = view.author.handle.map { "@\($0)" } ?? view.author.did
        text = view.record?.text ?? ""
        createdAt = view.record?.createdAt.flatMap(Self.date) ?? Self.date(view.indexedAt)
        parentURI = view.record?.parent?.uri
        replyCount = view.replyCount ?? 0
        moderationCauses = ModerationPolicy.causes(
            labels: view.labels, selfLabels: [], postURI: view.uri, authorDID: view.author.did
        )
    }

    init(localID: String, authorDID: String, authorHandle: String, text: String, parentURI: String?) {
        id = localID
        cid = nil
        self.authorDID = authorDID
        self.authorHandle = authorHandle
        self.text = text
        createdAt = Date()
        self.parentURI = parentURI
        replyCount = 0
        moderationCauses = []
        state = .sending
    }

    private init(copying item: CommentItem, id: String, cid: String) {
        self.id = id
        self.cid = cid
        authorDID = item.authorDID
        authorHandle = item.authorHandle
        text = item.text
        createdAt = item.createdAt
        parentURI = item.parentURI
        replyCount = item.replyCount
        moderationCauses = item.moderationCauses
        state = .posted
    }

    func posted(as output: CreateRecordOutput) -> CommentItem {
        CommentItem(copying: self, id: output.uri, cid: output.cid)
    }

    private static func date(_ string: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: string) ?? ISO8601DateFormatter().date(from: string)
    }
}

/// The comments on one reel: loading and paging them from the AppView
/// (`social.openreel.video.getComments`), replies on demand, and writing and
/// deleting the viewer's own (`social.openreel.video.comment` records in
/// their repository).
///
/// Writing works against any PDS today. Reading needs the AppView endpoint;
/// until it exists the sheet says so and keeps the viewer's new comments on
/// screen for the session. See docs/architecture/comments.md.
@MainActor
@Observable
final class CommentStore {
    enum Phase: Equatable {
        case loading
        case loaded
        /// The AppView has no comments endpoint yet.
        case unavailable
        case failed(String)
    }

    let reel: Reel
    private(set) var phase: Phase = .loading
    /// Top-level comments, in the AppView's order, with the viewer's new
    /// ones first.
    private(set) var comments: [CommentItem] = []
    /// Replies by top-level comment URI, oldest first.
    private(set) var replies: [String: [CommentItem]] = [:]
    /// Top-level comments whose replies are showing.
    private(set) var expanded: Set<String> = []
    private(set) var loadingReplies: Set<String> = []
    private(set) var isLoadingMore = false
    /// Comments the viewer wrote or deleted this session, on top of the
    /// AppView's count.
    private(set) var countAdjustment = 0
    private(set) var actionError: String?

    var draft = ""
    /// The comment being replied to (top-level or reply).
    private(set) var replyingTo: CommentItem?

    @ObservationIgnored private var cursor: String?
    @ObservationIgnored private var replyCursors: [String: String] = [:]
    /// The viewer's comments this session, so a reload doesn't drop them
    /// before the AppView indexes them.
    @ObservationIgnored private var ownPosts: [CommentItem] = []

    private let appView: AppViewClient
    private let auth: AuthController
    let moderation: ModerationController

    static let pageSize = 30

    init(reel: Reel, appView: AppViewClient, auth: AuthController, moderation: ModerationController) {
        self.reel = reel
        self.appView = appView
        self.auth = auth
        self.moderation = moderation
    }

    var count: Int { max(0, reel.commentCount + countAdjustment) }

    var canComment: Bool { auth.session != nil }

    var canSend: Bool {
        canComment && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && draft.count <= CommentLimits.maxGraphemes
    }

    func isMine(_ item: CommentItem) -> Bool {
        item.authorDID == auth.session?.did.rawValue
    }

    // MARK: - Moderation

    func decision(for item: CommentItem) -> ModerationDecision {
        ModerationPolicy.decide(item.moderationCauses, preferences: moderation.preferences)
    }

    func visible(_ items: [CommentItem]) -> [CommentItem] {
        items.filter { !decision(for: $0).isHidden }
    }

    // MARK: - Loading

    func load() async {
        phase = .loading
        do {
            let page = try await appView.getComments(on: reel.id, limit: Self.pageSize)
            let loaded = page.comments.map(CommentItem.init(view:))
            let indexed = Set(loaded.map(\.id))
            comments = ownPosts.filter { $0.parentURI == nil && !indexed.contains($0.id) } + loaded
            cursor = page.cursor
            phase = .loaded
        } catch {
            if Self.isMissingEndpoint(error) {
                comments = ownPosts.filter { $0.parentURI == nil }
                phase = .unavailable
            } else {
                phase = .failed(Self.message(forLoadError: error))
            }
        }
    }

    func loadMoreIfNeeded(after item: CommentItem) async {
        guard phase == .loaded, !isLoadingMore, let cursor, item.id == comments.last?.id else { return }
        isLoadingMore = true
        defer { isLoadingMore = false }
        do {
            let page = try await appView.getComments(on: reel.id, limit: Self.pageSize, cursor: cursor)
            let seen = Set(comments.map(\.id))
            comments += page.comments.map(CommentItem.init(view:)).filter { !seen.contains($0.id) }
            self.cursor = page.cursor
        } catch {
            // Keep the cursor; scrolling back to the end retries.
            print("[comments] could not load more: \(error)")
        }
    }

    func toggleReplies(for item: CommentItem) async {
        if expanded.contains(item.id) {
            expanded.remove(item.id)
            return
        }
        expanded.insert(item.id)
        if replies[item.id] == nil || replyCursors[item.id] != nil {
            await loadReplies(for: item)
        }
    }

    func hasMoreReplies(for item: CommentItem) -> Bool {
        replyCursors[item.id] != nil
    }

    func loadReplies(for item: CommentItem) async {
        guard !loadingReplies.contains(item.id), phase == .loaded else { return }
        loadingReplies.insert(item.id)
        defer { loadingReplies.remove(item.id) }
        do {
            let page = try await appView.getComments(
                on: reel.id, parent: item.id, limit: Self.pageSize, cursor: replyCursors[item.id]
            )
            // Earlier pages first, then this page, then the viewer's own
            // replies the AppView hasn't returned yet.
            let existing = replies[item.id] ?? []
            let ownIDs = Set(ownPosts.map(\.id))
            let isOwn = { (reply: CommentItem) in reply.state != .posted || ownIDs.contains(reply.id) }
            let earlier = existing.filter { !isOwn($0) }
            let earlierIDs = Set(earlier.map(\.id))
            let loaded = page.comments.map(CommentItem.init(view:)).filter { !earlierIDs.contains($0.id) }
            let loadedIDs = Set(loaded.map(\.id))
            let own = existing.filter { isOwn($0) && !loadedIDs.contains($0.id) }
            replies[item.id] = earlier + loaded + own
            replyCursors[item.id] = page.cursor
        } catch {
            actionError = Self.message(forLoadError: error)
        }
    }

    // MARK: - Writing

    func reply(to item: CommentItem) {
        replyingTo = item
        // Threads are one level deep, so a reply to a reply names who it
        // answers.
        if item.parentURI != nil, !draft.hasPrefix(item.authorHandle) {
            draft = "\(item.authorHandle) " + draft
        }
    }

    func cancelReply() {
        if let replyingTo, draft.hasPrefix("\(replyingTo.authorHandle) ") {
            draft.removeFirst(replyingTo.authorHandle.count + 1)
        }
        replyingTo = nil
    }

    func send() {
        guard canSend, let session = auth.session else { return }
        let text = draft
        let target = replyingTo
        // A reply belongs to the top-level comment, even when answering a reply.
        let parent = target.flatMap { $0.parentURI == nil ? $0 : topLevel($0.parentURI) }
        if target != nil, parent?.strongRef == nil {
            actionError = "Wait for that comment to finish posting before replying."
            return
        }
        let parentURI = parent?.id
        let parentRef = parent?.strongRef

        let item = CommentItem(
            localID: "local:\(UUID().uuidString)",
            authorDID: session.did.rawValue,
            authorHandle: session.handle.map { "@\($0.rawValue)" } ?? session.did.rawValue,
            text: text.trimmingCharacters(in: .whitespacesAndNewlines),
            parentURI: parentURI
        )
        insert(item)
        draft = ""
        replyingTo = nil
        actionError = nil
        countAdjustment += 1
        Task { await write(item, text: text, parent: parentRef) }
    }

    func retry(_ item: CommentItem) {
        guard case .failed = item.state else { return }
        var retrying = item
        retrying.state = .sending
        replace(item.id, with: retrying)
        countAdjustment += 1
        Task { await write(retrying, text: item.text, parent: topLevel(item.parentURI)?.strongRef) }
    }

    private func write(_ item: CommentItem, text: String, parent: StrongRef?) async {
        do {
            let output = try await auth.manager.postComment(text, on: reel.strongRef, parent: parent)
            let posted = item.posted(as: output)
            replace(item.id, with: posted)
            ownPosts.append(posted)
            if let parentURI = posted.parentURI {
                updateReplyCount(of: parentURI, by: 1)
            }
        } catch {
            print("[comments] could not post: \(error)")
            var failed = item
            failed.state = .failed(Self.message(forWriteError: error))
            replace(item.id, with: failed)
            countAdjustment -= 1
        }
    }

    func delete(_ item: CommentItem) {
        guard isMine(item) else { return }
        remove(item.id)
        guard item.state == .posted else { return }
        countAdjustment -= 1
        ownPosts.removeAll { $0.id == item.id }
        if let parentURI = item.parentURI { updateReplyCount(of: parentURI, by: -1) }
        Task {
            do {
                try await auth.manager.deleteComment(uri: item.id)
            } catch {
                print("[comments] could not delete: \(error)")
                insert(item)
                countAdjustment += 1
                if let parentURI = item.parentURI { updateReplyCount(of: parentURI, by: 1) }
                actionError = "Couldn't delete your comment. \(Self.message(forWriteError: error))"
            }
        }
    }

    func dismissError() {
        actionError = nil
    }

    // MARK: - Bookkeeping

    private func topLevel(_ uri: String?) -> CommentItem? {
        guard let uri else { return nil }
        return comments.first { $0.id == uri }
    }

    private func insert(_ item: CommentItem) {
        if let parentURI = item.parentURI {
            replies[parentURI, default: []].append(item)
            expanded.insert(parentURI)
        } else {
            comments.insert(item, at: 0)
        }
    }

    private func replace(_ id: String, with item: CommentItem) {
        if let index = comments.firstIndex(where: { $0.id == id }) {
            comments[index] = item
        }
        for (parent, list) in replies {
            if let index = list.firstIndex(where: { $0.id == id }) {
                replies[parent]?[index] = item
            }
        }
    }

    private func remove(_ id: String) {
        comments.removeAll { $0.id == id }
        for parent in replies.keys {
            replies[parent]?.removeAll { $0.id == id }
        }
        replies[id] = nil
    }

    private func updateReplyCount(of parentURI: String, by delta: Int) {
        if let index = comments.firstIndex(where: { $0.id == parentURI }) {
            comments[index].replyCount = max(0, comments[index].replyCount + delta)
        }
    }

    // MARK: - Errors

    /// An AppView without `getComments`: nginx or the router answers 404
    /// with no Lexicon error of ours, or an XRPC server answers 501.
    static func isMissingEndpoint(_ error: Error) -> Bool {
        switch error {
        case let ATProtoError.xrpc(status, code, _):
            return (status == 404 && code != "NotFound") || status == 501 || code == "MethodNotImplemented"
        case let ATProtoError.serverUnavailable(.serverError(_, status)):
            return status == 501
        default:
            return false
        }
    }

    static func message(forLoadError error: Error) -> String {
        if case let ATProtoError.xrpc(404, code, _) = error, code == "NotFound" {
            return "This video isn't available anymore."
        }
        return UserFacingError.message(for: error)
    }

    static func message(forWriteError error: Error) -> String {
        switch error {
        case CommentError.empty:
            return "Write something first."
        case let CommentError.tooLong(limit):
            return "Comments can be up to \(limit) characters."
        case ATProtoError.sessionExpired, ATProtoError.notSignedIn:
            return "Sign in again to comment."
        case let ATProtoError.xrpc(status, code, detail):
            return "The server rejected it: \(detail ?? code ?? "HTTP \(status)")."
        default:
            return UserFacingError.message(for: error)
        }
    }
}
