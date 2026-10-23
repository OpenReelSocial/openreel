import Foundation

/// A Lexicon `blob`: content uploaded to the author's PDS, referenced from a
/// record by CID. Written back exactly as `uploadBlob` returned it.
public struct BlobRef: Codable, Sendable, Equatable {
    /// CID of the content.
    public let link: String
    public let mimeType: String
    /// Bytes.
    public let size: Int

    public init(link: String, mimeType: String, size: Int) {
        self.link = link
        self.mimeType = mimeType
        self.size = size
    }

    private enum CodingKeys: String, CodingKey {
        case type = "$type"
        case ref, mimeType, size
    }

    private struct Link: Codable {
        let link: String

        enum CodingKeys: String, CodingKey {
            case link = "$link"
        }
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        link = try container.decode(Link.self, forKey: .ref).link
        mimeType = try container.decode(String.self, forKey: .mimeType)
        size = try container.decode(Int.self, forKey: .size)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode("blob", forKey: .type)
        try container.encode(Link(link: link), forKey: .ref)
        try container.encode(mimeType, forKey: .mimeType)
        try container.encode(size, forKey: .size)
    }
}

/// Output of `com.atproto.repo.uploadBlob`.
struct UploadBlobOutput: Decodable {
    let blob: BlobRef
}

extension ATProtoSessionManager {
    public static let uploadBlobNSID = "com.atproto.repo.uploadBlob"

    /// Uploads `data` to the signed-in account's PDS. The blob is only kept
    /// if a record references it soon after, so create that record next.
    public func uploadBlob(_ data: Data, mimeType: String,
                           uploadProgress: UploadProgressHandler? = nil) async throws -> BlobRef {
        guard let session else { throw ATProtoError.notSignedIn }
        var request = XRPC.procedureRequest(service: session.pdsURL, nsid: Self.uploadBlobNSID)
        request.setValue(mimeType, forHTTPHeaderField: "Content-Type")
        request.httpBody = data
        let response = try await authorizedSend(request, uploadProgress: uploadProgress)
        return try XRPC.decode(response, as: UploadBlobOutput.self).blob
    }
}
