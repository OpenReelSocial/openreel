import OpenReelATProto
import SwiftUI

/// The comment section for one reel, as a sheet over the feed: comments with
/// their replies, and a composer pinned to the bottom. Opened from the reel's
/// action fan (hold the heart → Comments).
struct CommentsView: View {
    @State private var store: CommentStore
    @Environment(\.dismiss) private var dismiss
    @FocusState private var isComposing: Bool
    @State private var reporting: CommentItem?
    @State private var revealed: Set<String> = []

    init(store: CommentStore) {
        _store = State(initialValue: store)
    }

    var body: some View {
        @Bindable var store = store
        VStack(spacing: 0) {
            header
            Divider().overlay(MonoTheme.primary.opacity(0.1))
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            composer(draft: $store.draft)
        }
        .background(MonoTheme.background)
        .foregroundStyle(MonoTheme.primary)
        .task { await store.load() }
        .sheet(item: $reporting) { item in
            ReportView(
                targets: reportTargets(for: item),
                authorHandle: item.authorHandle,
                moderation: store.moderation
            )
            .preferredColorScheme(.dark)
        }
    }

    // MARK: - Header

    private var header: some View {
        ZStack {
            Text(store.count == 1 ? "1 comment" : "\(store.count.formatted()) comments")
                .font(.subheadline.weight(.semibold))
                .contentTransition(.numericText(value: Double(store.count)))
                .animation(.snappy, value: store.count)
            HStack {
                Spacer()
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark")
                        .font(.subheadline.weight(.semibold))
                        .frame(width: 44, height: 44)
                }
                .accessibilityLabel("Close comments")
            }
        }
        .frame(height: 48)
        .padding(.horizontal, 8)
    }

    // MARK: - List

    @ViewBuilder
    private var content: some View {
        switch store.phase {
        case .loading:
            ProgressView()
                .tint(MonoTheme.primary)
        case let .failed(message):
            status(message, systemImage: "wifi.exclamationmark", retry: true)
        case .unavailable where store.comments.isEmpty:
            status(
                "Comments aren't available on this server yet. Anything you post is saved to your account and will show up here once they are.",
                systemImage: "bubble.left.and.exclamationmark.bubble.right",
                retry: false
            )
        case .loaded where store.visible(store.comments).isEmpty:
            status("No comments yet. Start the conversation.", systemImage: "bubble.left.and.bubble.right", retry: false)
        case .loaded, .unavailable:
            list
        }
    }

    private var list: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 18) {
                if store.phase == .unavailable {
                    Label("Comments aren't on this server yet; only yours from this session are shown.", systemImage: "info.circle")
                        .font(.caption)
                        .foregroundStyle(MonoTheme.secondary)
                }
                ForEach(store.visible(store.comments)) { item in
                    VStack(alignment: .leading, spacing: 12) {
                        row(item)
                        replies(for: item)
                    }
                    .task { await store.loadMoreIfNeeded(after: item) }
                }
                if store.isLoadingMore {
                    ProgressView()
                        .tint(MonoTheme.primary)
                        .frame(maxWidth: .infinity)
                }
            }
            .padding(16)
        }
        .scrollDismissesKeyboard(.interactively)
    }

    @ViewBuilder
    private func replies(for item: CommentItem) -> some View {
        let loaded = store.visible(store.replies[item.id] ?? [])
        let isExpanded = store.expanded.contains(item.id)
        VStack(alignment: .leading, spacing: 12) {
            if isExpanded {
                ForEach(loaded) { reply in
                    row(reply)
                }
            }
            if store.loadingReplies.contains(item.id) {
                ProgressView()
                    .tint(MonoTheme.primary)
            } else if item.replyCount > 0 || !loaded.isEmpty {
                Button {
                    Task {
                        if isExpanded, store.hasMoreReplies(for: item) {
                            await store.loadReplies(for: item)
                        } else {
                            await store.toggleReplies(for: item)
                        }
                    }
                } label: {
                    HStack(spacing: 8) {
                        Rectangle()
                            .fill(MonoTheme.secondary)
                            .frame(width: 20, height: 1)
                        Text(repliesButtonTitle(item, loaded: loaded.count, isExpanded: isExpanded))
                            .font(.caption.weight(.semibold))
                    }
                    .foregroundStyle(MonoTheme.secondary)
                }
                .buttonStyle(.plain)
                .disabled(store.phase != .loaded && !isExpanded)
            }
        }
        .padding(.leading, 44)
    }

    private func repliesButtonTitle(_ item: CommentItem, loaded: Int, isExpanded: Bool) -> String {
        if !isExpanded {
            let count = max(item.replyCount, loaded)
            return count == 1 ? "View 1 reply" : "View \(count) replies"
        }
        return store.hasMoreReplies(for: item) ? "View more replies" : "Hide replies"
    }

    // MARK: - Row

    @ViewBuilder
    private func row(_ item: CommentItem) -> some View {
        let decision = store.decision(for: item)
        if decision.isCovered && !revealed.contains(item.id) {
            HStack(spacing: 10) {
                Image(systemName: "eye.slash")
                Text("Comment hidden: \(decision.coverCauses.map(\.title).joined(separator: ", "))")
                    .font(.footnote)
                Spacer()
                Button("Show") { revealed.insert(item.id) }
                    .font(.footnote.weight(.semibold))
            }
            .foregroundStyle(MonoTheme.secondary)
            .padding(10)
            .background(MonoTheme.chipFill, in: RoundedRectangle(cornerRadius: 10))
        } else {
            CommentRow(
                item: item,
                badges: decision.badges.map { "\($0.title) · \(store.moderation.sourceName(for: $0))" },
                isMine: store.isMine(item),
                canReply: store.canComment,
                onReply: {
                    store.reply(to: item)
                    isComposing = true
                },
                onRetry: { store.retry(item) },
                onDelete: { store.delete(item) },
                onReport: { reporting = item }
            )
        }
    }

    private func reportTargets(for item: CommentItem) -> [ReportTarget] {
        var targets: [ReportTarget] = []
        if let ref = item.strongRef {
            targets.append(ReportTarget(title: "This comment", subject: .record(ref)))
        }
        targets.append(.account(did: item.authorDID, handle: item.authorHandle))
        return targets
    }

    // MARK: - Composer

    private func composer(draft: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if let message = store.actionError {
                HStack(alignment: .top) {
                    Label(message, systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.orange)
                    Spacer()
                    Button {
                        store.dismissError()
                    } label: {
                        Image(systemName: "xmark")
                    }
                    .accessibilityLabel("Dismiss")
                }
                .font(.caption)
            }
            if let target = store.replyingTo {
                HStack {
                    Text("Replying to \(target.authorHandle)")
                        .font(.caption)
                        .foregroundStyle(MonoTheme.secondary)
                        .lineLimit(1)
                    Spacer()
                    Button {
                        store.cancelReply()
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(MonoTheme.secondary)
                    }
                    .accessibilityLabel("Cancel reply")
                }
            }
            HStack(alignment: .bottom, spacing: 10) {
                TextField(
                    store.canComment ? "Add a comment…" : "Sign in to comment",
                    text: draft,
                    axis: .vertical
                )
                .lineLimit(1...4)
                .focused($isComposing)
                .disabled(!store.canComment)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(MonoTheme.chipFill, in: RoundedRectangle(cornerRadius: 20))

                Button {
                    store.send()
                } label: {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.system(size: 32))
                        .foregroundStyle(store.canSend ? MonoTheme.accent : MonoTheme.secondary)
                }
                .disabled(!store.canSend)
                .accessibilityLabel("Post comment")
            }
            if store.draft.count > CommentLimits.maxGraphemes - 50 {
                Text("\(store.draft.count)/\(CommentLimits.maxGraphemes)")
                    .font(.caption)
                    .foregroundStyle(store.draft.count > CommentLimits.maxGraphemes ? .orange : MonoTheme.secondary)
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(MonoTheme.background)
        .overlay(alignment: .top) {
            Rectangle()
                .fill(MonoTheme.primary.opacity(0.1))
                .frame(height: 0.5)
        }
    }

    private func status(_ text: String, systemImage: String, retry: Bool) -> some View {
        VStack(spacing: 14) {
            Image(systemName: systemImage)
                .font(.largeTitle)
            Text(text)
                .font(.subheadline)
                .multilineTextAlignment(.center)
                .foregroundStyle(MonoTheme.secondary)
            if retry {
                Button("Try again") {
                    Task { await store.load() }
                }
                .buttonStyle(.bordered)
                .tint(MonoTheme.primary)
            }
        }
        .padding(32)
    }
}

/// One comment: author, time, text, and its actions.
private struct CommentRow: View {
    let item: CommentItem
    let badges: [String]
    let isMine: Bool
    let canReply: Bool
    let onReply: () -> Void
    let onRetry: () -> Void
    let onDelete: () -> Void
    let onReport: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Circle()
                .fill(Color(white: 0.16))
                .overlay(
                    Text(initial)
                        .font(.footnote.weight(.semibold))
                )
                .frame(width: 34, height: 34)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(item.authorHandle)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(MonoTheme.secondary)
                        .lineLimit(1)
                    if let createdAt = item.createdAt, item.state == .posted {
                        Text(createdAt, format: .relative(presentation: .numeric, unitsStyle: .narrow))
                            .font(.caption)
                            .foregroundStyle(MonoTheme.secondary.opacity(0.8))
                    }
                }
                Text(item.text)
                    .font(.subheadline)
                    .fixedSize(horizontal: false, vertical: true)
                ForEach(badges, id: \.self) { badge in
                    Label(badge, systemImage: "shield")
                        .font(.caption2)
                        .foregroundStyle(MonoTheme.overlayText)
                        .padding(.horizontal, 8)
                        .frame(height: 22)
                        .background(MonoTheme.chipFill, in: Capsule())
                }
                footer
            }
            Spacer(minLength: 0)
        }
        .opacity(item.state == .sending ? 0.55 : 1)
        .contentShape(Rectangle())
        .contextMenu { menu }
        .accessibilityElement(children: .combine)
        .accessibilityActions { menu }
    }

    @ViewBuilder
    private var footer: some View {
        switch item.state {
        case .sending:
            Text("Posting…")
                .font(.caption)
                .foregroundStyle(MonoTheme.secondary)
        case let .failed(message):
            HStack(spacing: 10) {
                Text(message)
                    .foregroundStyle(.orange)
                Button("Retry", action: onRetry)
                    .fontWeight(.semibold)
                Button("Delete", role: .destructive, action: onDelete)
            }
            .font(.caption)
        case .posted:
            if canReply {
                Button("Reply", action: onReply)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(MonoTheme.secondary)
                    .buttonStyle(.plain)
            }
        }
    }

    @ViewBuilder
    private var menu: some View {
        if item.state == .posted {
            if canReply {
                Button("Reply", systemImage: "arrowshape.turn.up.left", action: onReply)
            }
            Button("Copy text", systemImage: "doc.on.doc") {
                UIPasteboard.general.string = item.text
            }
            if isMine {
                Button("Delete", systemImage: "trash", role: .destructive, action: onDelete)
            } else {
                Button("Report", systemImage: "flag", action: onReport)
            }
        }
    }

    private var initial: String {
        let name = item.authorHandle.drop(while: { $0 == "@" })
        return name.first.map { String($0).uppercased() } ?? "?"
    }
}
