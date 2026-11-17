import OpenReelATProto
import SwiftUI

/// The viewer's feeds: the tabs over the video, which they can reorder or
/// hide, the feeds they hid, and a field to add feeds someone else runs by
/// domain (ADR-0010). Changes are saved on the device as they are made.
struct MyFeedsView: View {
    let store: FeedStore
    /// Switches the feed, as tapping its tab would.
    var onSelect: (FeedGeneratorView) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var domain = ""
    @State private var lookup: Lookup = .idle
    @FocusState private var isDomainFocused: Bool

    private enum Lookup: Equatable {
        case idle
        case searching
        case found(host: String, feeds: [FeedGeneratorView])
        case failed(String)
    }

    var body: some View {
        NavigationStack {
            List {
                tabsSection
                hiddenSection
                addSection
            }
            // Always editing, so the tabs show their reorder handles.
            .environment(\.editMode, .constant(.active))
            .navigationTitle("My feeds")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    // MARK: - Sections

    private var tabsSection: some View {
        Section {
            ForEach(store.tabFeeds) { feed in
                FeedRow(feed: feed, isWatching: feed.uri == store.selectedFeedURI, source: source(of: feed)) {
                    Button { hide(feed) } label: {
                        Image(systemName: "minus.circle.fill")
                            .symbolRenderingMode(.palette)
                            .foregroundStyle(MonoTheme.primary, MonoTheme.chipFill)
                    }
                    .disabled(!store.canHide(feed))
                    .accessibilityLabel("Hide \(feed.displayName)")
                }
            }
            .onMove { from, to in
                var tabs = store.tabFeeds
                tabs.move(fromOffsets: from, toOffset: to)
                store.setTabOrder(tabs)
            }
        } header: {
            Text("Tabs · \(store.tabFeeds.count)")
        } footer: {
            Text("These are the tabs over your videos. Drag to reorder, or hide ones you don't use. Saved on this device.")
        }
    }

    private var hiddenSection: some View {
        Section("Hidden") {
            if store.hiddenFeeds.isEmpty {
                Text("Feeds you hide show up here, so you can bring them back.")
                    .font(.subheadline)
                    .foregroundStyle(MonoTheme.secondary)
            }
            ForEach(store.hiddenFeeds) { feed in
                FeedRow(feed: feed, isWatching: false, source: source(of: feed)) {
                    Button { store.show(feed) } label: {
                        Image(systemName: "plus.circle.fill")
                            .symbolRenderingMode(.palette)
                            .foregroundStyle(MonoTheme.onAccent, MonoTheme.accent)
                    }
                    .accessibilityLabel("Show \(feed.displayName) as a tab")
                } trailing: {
                    if store.isAdded(feed) {
                        Button(role: .destructive) { store.remove(feed) } label: {
                            Image(systemName: "trash")
                        }
                        .accessibilityLabel("Remove \(feed.displayName)")
                    }
                }
            }
            .moveDisabled(true)
        }
    }

    private var addSection: some View {
        Section {
            HStack(spacing: 12) {
                TextField("feeds.example.com", text: $domain)
                    .keyboardType(.URL)
                    .textContentType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.search)
                    .focused($isDomainFocused)
                    .onSubmit(lookUp)
                    .accessibilityLabel("Feed generator domain")
                if lookup == .searching {
                    ProgressView()
                } else {
                    Button("Look up", action: lookUp)
                        .fontWeight(.semibold)
                        .disabled(domain.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .buttonStyle(.borderless)
            .moveDisabled(true)

            switch lookup {
            case .idle, .searching:
                EmptyView()
            case let .failed(message):
                Label(message, systemImage: "exclamationmark.circle")
                    .font(.subheadline)
                    .foregroundStyle(MonoTheme.secondary)
                    .moveDisabled(true)
            case let .found(host, feeds):
                ForEach(feeds) { feed in
                    FeedRow(feed: feed, isWatching: false, source: host, showsDescription: true) {
                        EmptyView()
                    } trailing: {
                        if store.tabFeeds.contains(feed) {
                            Label("Added", systemImage: "checkmark")
                                .labelStyle(.iconOnly)
                                .foregroundStyle(MonoTheme.secondary)
                                .accessibilityLabel("\(feed.displayName) added")
                        } else {
                            Button("Add") { store.add([feed]) }
                                .fontWeight(.semibold)
                                .accessibilityLabel("Add \(feed.displayName)")
                        }
                    }
                }
                .moveDisabled(true)
            }
        } header: {
            Text("Add a feed")
        } footer: {
            Text("Enter the domain of a feed generator someone else runs. Its feeds choose and order OpenReel videos their own way; how they rank is described by whoever runs them.")
        }
    }

    // MARK: - Actions

    /// Where an added feed comes from; `nil` for the AppView's own.
    private func source(of feed: FeedGeneratorView) -> String? {
        guard store.isAdded(feed), !store.feeds.contains(feed), let authority = feed.authority else { return nil }
        return authority.hasPrefix("did:web:") ? String(authority.dropFirst("did:web:".count)) : authority
    }

    /// Hiding the feed being watched switches to the first remaining tab.
    private func hide(_ feed: FeedGeneratorView) {
        let wasWatching = feed.uri == store.selectedFeedURI
        store.hide(feed)
        if wasWatching, let next = store.tabFeeds.first {
            onSelect(next)
        }
    }

    private func lookUp() {
        let input = domain
        guard !input.trimmingCharacters(in: .whitespaces).isEmpty, lookup != .searching else { return }
        isDomainFocused = false
        lookup = .searching
        Task {
            do {
                let result = try await store.lookUpFeeds(at: input)
                lookup = .found(host: result.host, feeds: result.feeds)
            } catch {
                lookup = .failed(Self.message(for: error, domain: input))
            }
        }
    }

    static func message(for error: Error, domain: String) -> String {
        if let error = error as? FeedLookupError {
            switch error {
            case .invalidDomain:
                return "Enter a domain like feeds.example.com."
            case let .noFeeds(host):
                return "\(host) doesn't list any feeds it serves."
            }
        }
        let name = domain.trimmingCharacters(in: .whitespacesAndNewlines)
        switch error as? ATProtoError {
        case .xrpc(status: 404, _, _)?, .xrpc(status: 501, _, _)?, .invalidResponse?:
            return "\(name) isn't running an OpenReel feed generator."
        default:
            return UserFacingError.message(for: error)
        }
    }
}

/// One feed: its ranking family's symbol, name, and how it ranks, with a
/// control on either side.
private struct FeedRow<Leading: View, Trailing: View>: View {
    let feed: FeedGeneratorView
    let isWatching: Bool
    /// The host of a feed from another generator.
    var source: String?
    var showsDescription = false
    @ViewBuilder var leading: () -> Leading
    @ViewBuilder var trailing: () -> Trailing

    init(feed: FeedGeneratorView, isWatching: Bool, source: String?, showsDescription: Bool = false,
         @ViewBuilder leading: @escaping () -> Leading,
         @ViewBuilder trailing: @escaping () -> Trailing) {
        self.feed = feed
        self.isWatching = isWatching
        self.source = source
        self.showsDescription = showsDescription
        self.leading = leading
        self.trailing = trailing
    }

    var body: some View {
        HStack(spacing: 12) {
            leading()
                .font(.title3)
                .buttonStyle(.borderless)
            Image(systemName: FeedDisclosure.symbol(feed))
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(isWatching ? MonoTheme.onAccent : MonoTheme.primary)
                .frame(width: 36, height: 36)
                .background(isWatching ? MonoTheme.accent : MonoTheme.chipFill, in: .rect(cornerRadius: 10))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(feed.displayName)
                        .font(.body.weight(.semibold))
                        .lineLimit(1)
                    if isWatching {
                        Text("Watching")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(MonoTheme.secondary)
                    }
                }
                Text(FeedDisclosure.summary(feed))
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(MonoTheme.secondary)
                    .lineLimit(2)
                if showsDescription, let description = feed.description {
                    Text(description)
                        .font(.footnote)
                        .foregroundStyle(MonoTheme.secondary)
                        .lineLimit(3)
                }
                if let source {
                    Text("from \(source)")
                        .font(.caption)
                        .foregroundStyle(MonoTheme.secondary)
                }
            }
            Spacer(minLength: 0)
            trailing()
                .buttonStyle(.borderless)
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .contain)
    }
}

extension FeedRow where Trailing == EmptyView {
    init(feed: FeedGeneratorView, isWatching: Bool, source: String?, @ViewBuilder leading: @escaping () -> Leading) {
        self.init(feed: feed, isWatching: isWatching, source: source, leading: leading, trailing: { EmptyView() })
    }
}

#Preview {
    let store = FeedStore(
        loadFeeds: { MockReelProvider.feeds },
        loadPage: { _, _ in MockReelProvider.page },
        lookUp: { _ in ("feeds.example.com", MockReelProvider.externalFeeds) }
    )
    return MyFeedsView(store: store, onSelect: { _ in })
        .preferredColorScheme(.dark)
        .task { await store.loadIfNeeded() }
}
