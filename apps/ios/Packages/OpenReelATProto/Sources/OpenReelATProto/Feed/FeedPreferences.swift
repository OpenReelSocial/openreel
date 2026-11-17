import Foundation

/// How a viewer arranges their feeds: which show as tabs and in what order,
/// which are hidden, and which feeds from other generators they added. Kept
/// on the device; nothing here is published to the viewer's repository.
public struct FeedPreferences: Codable, Sendable, Equatable {
    /// Feed URIs in the order the viewer put their tabs. Feeds not listed
    /// (new from the AppView, say) follow, in the order they were offered.
    public private(set) var order: [String]
    public private(set) var hidden: Set<String>
    /// Feeds the viewer added from other generators, as they were described
    /// when added.
    public private(set) var added: [FeedGeneratorView]

    public init(order: [String] = [], hidden: Set<String> = [], added: [FeedGeneratorView] = []) {
        self.order = order
        self.hidden = hidden
        self.added = added
    }

    /// Every feed the viewer can choose from: the AppView's, then the added
    /// ones it does not already offer.
    public func available(suggested: [FeedGeneratorView]) -> [FeedGeneratorView] {
        let offered = Set(suggested.map(\.uri))
        return suggested + added.filter { !offered.contains($0.uri) }
    }

    /// The feeds to show as tabs, in the viewer's order.
    public func tabs(suggested: [FeedGeneratorView]) -> [FeedGeneratorView] {
        let rank = Dictionary(order.enumerated().map { ($1, $0) }, uniquingKeysWith: { first, _ in first })
        return available(suggested: suggested)
            .enumerated()
            .filter { !hidden.contains($0.element.uri) }
            .sorted { lhs, rhs in
                let left = rank[lhs.element.uri] ?? Int.max
                let right = rank[rhs.element.uri] ?? Int.max
                return left != right ? left < right : lhs.offset < rhs.offset
            }
            .map(\.element)
    }

    /// The feeds the viewer hid, in the order they are offered.
    public func hiddenFeeds(suggested: [FeedGeneratorView]) -> [FeedGeneratorView] {
        available(suggested: suggested).filter { hidden.contains($0.uri) }
    }

    public func isAdded(_ uri: String) -> Bool {
        added.contains { $0.uri == uri }
    }

    /// Whether hiding `uri` would still leave at least one tab.
    public func canHide(_ uri: String, suggested: [FeedGeneratorView]) -> Bool {
        tabs(suggested: suggested).contains { $0.uri != uri }
    }

    /// Records the tabs' new order after the viewer moved one.
    public mutating func setTabOrder(_ uris: [String]) {
        order = uris + order.filter { !uris.contains($0) }
    }

    public mutating func hide(_ uri: String) {
        hidden.insert(uri)
    }

    /// Shows a hidden feed again: the last tab once the tabs have an order
    /// (`setTabOrder`), its offered place otherwise.
    public mutating func show(_ uri: String) {
        hidden.remove(uri)
        moveToEnd(uri)
    }

    /// Adds feeds from another generator after the current tabs. A feed
    /// already added keeps its place; a hidden one is shown again.
    public mutating func add(_ feeds: [FeedGeneratorView]) {
        for feed in feeds {
            if let index = added.firstIndex(where: { $0.uri == feed.uri }) {
                added[index] = feed
            } else {
                added.append(feed)
                moveToEnd(feed.uri)
            }
            hidden.remove(feed.uri)
        }
    }

    /// Forgets a feed the viewer added. Feeds the AppView offers cannot be
    /// removed, only hidden.
    public mutating func remove(_ uri: String) {
        guard isAdded(uri) else { return }
        added.removeAll { $0.uri == uri }
        order.removeAll { $0 == uri }
        hidden.remove(uri)
    }

    /// Puts `uri` after every ordered feed. With no order yet, the AppView's
    /// order stands and added feeds already follow it.
    private mutating func moveToEnd(_ uri: String) {
        guard !order.isEmpty else { return }
        order.removeAll { $0 == uri }
        order.append(uri)
    }
}
