import Foundation

/// A validated `did:plc:` or `did:web:` identifier. The AT Protocol blesses
/// only these two methods; anything else is rejected at construction.
public struct DID: Hashable, Sendable, Codable, CustomStringConvertible {
    public let rawValue: String

    public static let supportedMethods: Set<String> = ["plc", "web"]

    public init(_ rawValue: String) throws {
        let trimmed = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        let parts = trimmed.split(separator: ":", maxSplits: 2, omittingEmptySubsequences: false)
        guard parts.count == 3, parts[0] == "did" else {
            throw ATProtoError.invalidIdentifier(rawValue)
        }
        let method = String(parts[1])
        let identifier = String(parts[2])
        guard Self.supportedMethods.contains(method),
              !identifier.isEmpty,
              trimmed.count <= 2048,
              identifier.unicodeScalars.allSatisfy(Self.isAllowedIdentifierScalar),
              let last = identifier.unicodeScalars.last, last != ":", last != "%"
        else {
            throw ATProtoError.invalidIdentifier(rawValue)
        }
        self.rawValue = trimmed
    }

    public var method: String {
        String(rawValue.split(separator: ":", maxSplits: 2)[1])
    }

    public var identifier: String {
        String(rawValue.split(separator: ":", maxSplits: 2)[2])
    }

    public var description: String { rawValue }

    public static func isDIDString(_ string: String) -> Bool {
        string.trimmingCharacters(in: .whitespacesAndNewlines).hasPrefix("did:")
    }

    /// Where the DID document lives: the PLC directory for `did:plc`, the
    /// hostname's `/.well-known/did.json` for `did:web`.
    func documentURL(plcDirectory: URL, allowInsecureLocalhost: Bool) throws -> URL {
        switch method {
        case "plc":
            return plcDirectory.appending(path: rawValue)
        case "web":
            // atproto restricts did:web to bare hostnames (optionally with a
            // percent-encoded port for localhost); path-based did:web is out.
            let host = identifier.replacingOccurrences(of: "%3A", with: ":")
            guard !host.contains(":") || host.lowercased().hasPrefix("localhost:") else {
                throw ATProtoError.didResolutionFailed(did: rawValue, detail: "did:web with a path or non-localhost port is not supported")
            }
            let scheme = allowInsecureLocalhost && host.lowercased().hasPrefix("localhost") ? "http" : "https"
            guard let url = URL(string: "\(scheme)://\(host)/.well-known/did.json") else {
                throw ATProtoError.didResolutionFailed(did: rawValue, detail: "invalid did:web host")
            }
            return url
        default:
            throw ATProtoError.invalidIdentifier(rawValue)
        }
    }

    private static func isAllowedIdentifierScalar(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar {
        case "a"..."z", "A"..."Z", "0"..."9", ".", "_", ":", "%", "-":
            return true
        default:
            return false
        }
    }
}

/// Handle syntax per the AT Protocol handle spec. Normalises to lowercase.
public struct Handle: Hashable, Sendable, Codable, CustomStringConvertible {
    public let rawValue: String

    private static let disallowedTLDs: Set<String> = [
        "alt", "arpa", "example", "internal", "invalid", "local", "localhost", "onion",
    ]

    public init(_ rawValue: String) throws {
        var value = rawValue.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if value.hasPrefix("@") { value.removeFirst() }
        guard Self.isValid(value) else { throw ATProtoError.invalidIdentifier(rawValue) }
        self.rawValue = value
    }

    public var description: String { rawValue }

    public static func isValid(_ handle: String) -> Bool {
        guard handle.count <= 253, !handle.isEmpty else { return false }
        let labels = handle.split(separator: ".", omittingEmptySubsequences: false)
        guard labels.count >= 2 else { return false }
        for label in labels {
            guard (1...63).contains(label.count),
                  !label.hasPrefix("-"), !label.hasSuffix("-"),
                  label.unicodeScalars.allSatisfy({ scalar in
                      switch scalar {
                      case "a"..."z", "0"..."9", "-": return true
                      default: return false
                      }
                  })
            else { return false }
        }
        let tld = String(labels[labels.count - 1])
        guard tld.count >= 2, tld.first.map({ !$0.isNumber }) == true else { return false }
        return !disallowedTLDs.contains(tld)
    }
}

// Encode both identifiers as bare strings so persisted sessions stay readable
// and the validation in `init(_:)` runs again on decode.
extension DID {
    public init(from decoder: Decoder) throws {
        try self.init(try decoder.singleValueContainer().decode(String.self))
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }
}

extension Handle {
    public init(from decoder: Decoder) throws {
        try self.init(try decoder.singleValueContainer().decode(String.self))
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }
}
