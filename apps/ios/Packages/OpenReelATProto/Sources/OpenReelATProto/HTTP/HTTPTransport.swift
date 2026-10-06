import Foundation

/// A completed HTTP exchange. Header names are lower-cased so lookups do not
/// depend on how a particular server capitalises `DPoP-Nonce`.
public struct HTTPResponse: Sendable, Equatable {
    public let statusCode: Int
    public let headers: [String: String]
    public let body: Data

    public init(statusCode: Int, headers: [String: String] = [:], body: Data = Data()) {
        self.statusCode = statusCode
        var lowered: [String: String] = [:]
        for (name, value) in headers {
            lowered[name.lowercased()] = value
        }
        self.headers = lowered
        self.body = body
    }

    public func header(_ name: String) -> String? {
        headers[name.lowercased()]
    }

    public var isSuccess: Bool { (200..<300).contains(statusCode) }

    func decodeJSON<T: Decodable>(_ type: T.Type) throws -> T {
        do {
            return try JSONDecoder().decode(type, from: body)
        } catch {
            throw ATProtoError.invalidResponse("Could not decode \(T.self): \(error)")
        }
    }
}

/// The single seam between this package and the network. Tests substitute a
/// stub; the app uses `URLSessionTransport`.
public protocol HTTPTransport: Sendable {
    func send(_ request: URLRequest) async throws -> HTTPResponse
}

public struct URLSessionTransport: HTTPTransport {
    private let session: URLSession

    public init(session: URLSession = .shared) {
        self.session = session
    }

    public func send(_ request: URLRequest) async throws -> HTTPResponse {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch let error as URLError {
            throw ATProtoError.serverUnavailable(.from(error, host: request.url?.hostName))
        }
        guard let http = response as? HTTPURLResponse else {
            throw ATProtoError.invalidResponse("Non-HTTP response from \(request.url?.absoluteString ?? "?")")
        }
        var headers: [String: String] = [:]
        for (name, value) in http.allHeaderFields {
            if let name = name as? String, let value = value as? String {
                headers[name] = value
            }
        }
        return HTTPResponse(statusCode: http.statusCode, headers: headers, body: data)
    }
}

/// Thin wrapper that turns 5xx answers into `serverUnavailable` so callers only
/// ever reason about 2xx/4xx.
struct HTTPClient: Sendable {
    let transport: any HTTPTransport

    func send(_ request: URLRequest) async throws -> HTTPResponse {
        let response = try await transport.send(request)
        if response.statusCode >= 500 {
            throw ATProtoError.serverUnavailable(
                .serverError(host: request.url?.hostName ?? "unknown host", status: response.statusCode)
            )
        }
        return response
    }

    func get(_ url: URL, accept: String = "application/json", timeout: TimeInterval? = nil) async throws -> HTTPResponse {
        var request = URLRequest(url: url)
        if let timeout { request.timeoutInterval = timeout }
        request.httpMethod = "GET"
        request.setValue(accept, forHTTPHeaderField: "Accept")
        return try await send(request)
    }
}

extension URL {
    /// Non-deprecated spelling of `host`.
    var hostName: String? { host(percentEncoded: false) }

    /// `scheme://host[:port]` with no path, query, or fragment. Used for issuer
    /// comparisons, where the spec talks in terms of origins.
    var origin: String? {
        guard let scheme, let host = hostName else { return nil }
        if let port, !isDefaultPort(port, for: scheme) {
            return "\(scheme)://\(host):\(port)"
        }
        return "\(scheme)://\(host)"
    }

    private func isDefaultPort(_ port: Int, for scheme: String) -> Bool {
        (scheme == "https" && port == 443) || (scheme == "http" && port == 80)
    }

    var isLoopbackHost: Bool {
        guard let host = hostName?.lowercased() else { return false }
        return host == "localhost" || host == "127.0.0.1" || host == "::1" || host == "[::1]"
    }
}
