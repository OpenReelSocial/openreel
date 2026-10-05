import Foundation

/// The subset of a DID document atproto clients need: the claimed handle and
/// the PDS service endpoint. Unknown fields and non-string service endpoints
/// are tolerated rather than failing the whole resolution.
public struct DIDDocument: Sendable, Equatable {
    public struct Service: Sendable, Equatable {
        public let id: String
        public let type: String
        public let serviceEndpoint: String
    }

    public let id: String
    public let alsoKnownAs: [String]
    public let services: [Service]

    public init(id: String, alsoKnownAs: [String], services: [Service]) {
        self.id = id
        self.alsoKnownAs = alsoKnownAs
        self.services = services
    }

    /// First `at://` alias, which atproto defines as the account's handle.
    public var handle: String? {
        for alias in alsoKnownAs where alias.hasPrefix("at://") {
            let handle = String(alias.dropFirst("at://".count))
            if Handle.isValid(handle) { return handle }
        }
        return nil
    }

    public func claims(handle: Handle) -> Bool {
        alsoKnownAs.contains("at://\(handle.rawValue)")
    }

    public var pdsEndpoint: URL? {
        let candidate = services.first { service in
            (service.id == "#atproto_pds" || service.id == "\(id)#atproto_pds")
                && service.type == "AtprotoPersonalDataServer"
        }
        guard let endpoint = candidate?.serviceEndpoint, let url = URL(string: endpoint),
              url.scheme == "https" || url.scheme == "http", url.hostName != nil
        else { return nil }
        return url
    }
}

extension DIDDocument: Decodable {
    private enum CodingKeys: String, CodingKey {
        case id, alsoKnownAs, service
    }

    private struct RawService: Decodable {
        let id: String
        let type: String
        let serviceEndpoint: String?

        private enum Keys: String, CodingKey { case id, type, serviceEndpoint }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: Keys.self)
            id = try container.decode(String.self, forKey: .id)
            type = try container.decode(String.self, forKey: .type)
            // Endpoints may legally be objects or arrays; atproto only uses strings.
            serviceEndpoint = try? container.decode(String.self, forKey: .serviceEndpoint)
        }
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        alsoKnownAs = try container.decodeIfPresent([String].self, forKey: .alsoKnownAs) ?? []
        let raw = try container.decodeIfPresent([RawService].self, forKey: .service) ?? []
        services = raw.compactMap { service in
            service.serviceEndpoint.map { Service(id: service.id, type: service.type, serviceEndpoint: $0) }
        }
    }
}
