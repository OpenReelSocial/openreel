import Foundation

/// Why looking up a feed generator by domain found nothing to add.
public enum FeedLookupError: Error, Equatable, Sendable {
    /// What the viewer typed is not a domain this client will contact.
    case invalidDomain(String)
    /// The host answered but lists no feeds it serves itself.
    case noFeeds(host: String)
}

/// Finds the feeds a third-party feed generator serves, so a viewer can add
/// them (ADR-0010). The generator is asked directly with
/// `social.openreel.feed.describeFeedGenerator`; playing a feed still goes
/// through the AppView's `getFeed`.
public struct FeedGeneratorDirectory: Sendable {
    public static let describeNSID = "social.openreel.feed.describeFeedGenerator"

    private let transport: any HTTPTransport

    public init(transport: any HTTPTransport = URLSessionTransport()) {
        self.transport = transport
    }

    /// The feeds served at `domain`. Only feeds whose URI authority is that
    /// host (or its `did:web`) are kept: the AppView fetches a feed from its
    /// URI's authority, so a host listing anyone else's feeds would be
    /// describing feeds it does not serve.
    public func feeds(at domain: String) async throws -> (host: String, feeds: [FeedGeneratorView]) {
        guard let host = Self.host(fromInput: domain), let service = URL(string: "https://\(host)") else {
            throw FeedLookupError.invalidDomain(domain)
        }
        let output = try await XRPCClient(serviceURL: service, transport: transport)
            .query(Self.describeNSID, as: DescribeFeedGeneratorOutput.self)
        let served = output.feeds.filter { $0.authority == host || $0.authority == "did:web:\(host)" }
        guard !served.isEmpty else { throw FeedLookupError.noFeeds(host: host) }
        return (host, served)
    }

    /// The host in what a viewer typed: a bare domain, an `https://` URL, a
    /// `did:web`, or a feed's `at://` URI. `nil` for anything that is not a
    /// public DNS name on the default port, the same names the AppView will
    /// fetch from.
    public static func host(fromInput input: String) -> String? {
        var text = input.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        for prefix in ["https://", "at://", "did:web:"] where text.hasPrefix(prefix) {
            text.removeFirst(prefix.count)
        }
        if let end = text.firstIndex(where: { $0 == "/" || $0 == "?" || $0 == "#" }) {
            text = String(text[..<end])
        }
        if text.hasSuffix(".") { text.removeLast() }
        guard isPublicHostname(text) else { return nil }
        return text
    }

    private static let localSuffixes = [".local", ".localhost", ".internal", ".arpa", ".lan"]

    /// At least two labels of letters, digits and inner hyphens, ending in a
    /// label that starts with a letter (so IP addresses never match).
    private static func isPublicHostname(_ name: String) -> Bool {
        guard name.count <= 253, !localSuffixes.contains(where: name.hasSuffix) else { return false }
        let labels = name.split(separator: ".", omittingEmptySubsequences: false)
        guard labels.count >= 2, let tld = labels.last, tld.first?.isLetter == true else { return false }
        return labels.allSatisfy { label in
            (1...63).contains(label.count)
                && label.allSatisfy { ($0.isASCII && ($0.isLetter || $0.isNumber)) || $0 == "-" }
                && label.first != "-" && label.last != "-"
        }
    }
}
