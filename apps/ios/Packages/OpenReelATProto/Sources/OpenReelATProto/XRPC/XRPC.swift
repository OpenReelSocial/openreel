import Foundation

/// Error body every `@atproto/*` server returns for 4xx responses.
public struct XRPCErrorBody: Decodable, Sendable, Equatable {
    public let error: String?
    public let message: String?
}

/// Request construction and response decoding for XRPC endpoints. Sending is
/// deliberately not here: unauthenticated calls go through `XRPCClient`, and
/// authenticated calls go through `ATProtoSessionManager`, which has to attach
/// DPoP material per request.
public enum XRPC {
    public static func queryRequest(service: URL, nsid: String, parameters: [String: String] = [:]) -> URLRequest {
        var request = URLRequest(url: endpoint(service: service, nsid: nsid).appendingQueryItems(parameters))
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        return request
    }

    public static func procedureRequest<Input: Encodable>(service: URL, nsid: String, input: Input?) throws -> URLRequest {
        var request = URLRequest(url: endpoint(service: service, nsid: nsid))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let input {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(input)
        }
        return request
    }

    public static func procedureRequest(service: URL, nsid: String) -> URLRequest {
        var request = URLRequest(url: endpoint(service: service, nsid: nsid))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        return request
    }

    public static func endpoint(service: URL, nsid: String) -> URL {
        service.appending(path: "xrpc/\(nsid)")
    }

    /// Decodes a successful response or throws the server's XRPC error.
    public static func decode<Output: Decodable>(_ response: HTTPResponse, as type: Output.Type) throws -> Output {
        try ensureSuccess(response)
        return try response.decodeJSON(type)
    }

    public static func ensureSuccess(_ response: HTTPResponse) throws {
        guard response.isSuccess else {
            let body = errorBody(response)
            throw ATProtoError.xrpc(status: response.statusCode, error: body?.error, message: body?.message)
        }
    }

    public static func errorBody(_ response: HTTPResponse) -> XRPCErrorBody? {
        try? JSONDecoder().decode(XRPCErrorBody.self, from: response.body)
    }
}

/// Unauthenticated XRPC calls against one service (handle resolution,
/// `describeServer`, health checks).
public struct XRPCClient: Sendable {
    public let serviceURL: URL
    private let http: HTTPClient

    public init(serviceURL: URL, transport: any HTTPTransport = URLSessionTransport()) {
        self.serviceURL = serviceURL
        self.http = HTTPClient(transport: transport)
    }

    public func query<Output: Decodable>(_ nsid: String, parameters: [String: String] = [:], as type: Output.Type) async throws -> Output {
        let response = try await http.send(XRPC.queryRequest(service: serviceURL, nsid: nsid, parameters: parameters))
        return try XRPC.decode(response, as: type)
    }

    public func procedure<Input: Encodable, Output: Decodable>(_ nsid: String, input: Input?, as type: Output.Type) async throws -> Output {
        let response = try await http.send(try XRPC.procedureRequest(service: serviceURL, nsid: nsid, input: input))
        return try XRPC.decode(response, as: type)
    }
}

public struct ResolveHandleOutput: Decodable, Sendable {
    public let did: String
}

/// `com.atproto.server.describeServer` — the cheapest way to confirm a PDS is
/// reachable before starting an OAuth flow.
public struct DescribeServerOutput: Decodable, Sendable {
    public let did: String
    public let availableUserDomains: [String]
    public let inviteCodeRequired: Bool?
}
