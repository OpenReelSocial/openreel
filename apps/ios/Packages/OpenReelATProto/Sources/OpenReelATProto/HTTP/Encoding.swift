import Foundation

extension Data {
    /// RFC 4648 §5 base64url without padding, as used by JWS and PKCE.
    func base64URLEncodedString() -> String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    init?(base64URLEncoded string: String) {
        var base64 = string
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let remainder = base64.count % 4
        if remainder > 0 {
            base64 += String(repeating: "=", count: 4 - remainder)
        }
        self.init(base64Encoded: base64)
    }

    static func random(count: Int) -> Data {
        var generator = SystemRandomNumberGenerator()
        return Data((0..<count).map { _ in UInt8.random(in: .min ... .max, using: &generator) })
    }
}

enum FormEncoding {
    /// `application/x-www-form-urlencoded` body with stable key order so tests
    /// can assert on exact bodies.
    static func encode(_ fields: [String: String]) -> Data {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        let pairs = fields.keys.sorted().map { key -> String in
            let value = fields[key] ?? ""
            let k = key.addingPercentEncoding(withAllowedCharacters: allowed) ?? key
            let v = value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
            return "\(k)=\(v)"
        }
        return Data(pairs.joined(separator: "&").utf8)
    }

    static func decode(_ data: Data) -> [String: String] {
        guard let string = String(data: data, encoding: .utf8) else { return [:] }
        var result: [String: String] = [:]
        for pair in string.split(separator: "&") {
            let parts = pair.split(separator: "=", maxSplits: 1).map(String.init)
            guard let key = parts.first?.removingPercentEncoding else { continue }
            let value = parts.count > 1 ? parts[1].replacingOccurrences(of: "+", with: " ").removingPercentEncoding ?? "" : ""
            result[key] = value
        }
        return result
    }
}

extension URL {
    func appendingQueryItems(_ items: [String: String]) -> URL {
        guard !items.isEmpty, var components = URLComponents(url: self, resolvingAgainstBaseURL: false) else {
            return self
        }
        var existing = components.queryItems ?? []
        for key in items.keys.sorted() {
            existing.append(URLQueryItem(name: key, value: items[key]))
        }
        components.queryItems = existing
        return components.url ?? self
    }

    var queryParameters: [String: String] {
        guard let items = URLComponents(url: self, resolvingAgainstBaseURL: false)?.queryItems else {
            return [:]
        }
        var result: [String: String] = [:]
        for item in items {
            result[item.name] = item.value ?? ""
        }
        return result
    }
}
