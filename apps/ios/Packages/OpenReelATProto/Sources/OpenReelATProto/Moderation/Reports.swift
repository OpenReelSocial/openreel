import Foundation

/// `com.atproto.moderation.defs#reasonType` values a viewer can pick.
public enum ReportReason: String, CaseIterable, Sendable, Identifiable {
    case spam = "com.atproto.moderation.defs#reasonSpam"
    case violation = "com.atproto.moderation.defs#reasonViolation"
    case misleading = "com.atproto.moderation.defs#reasonMisleading"
    case sexual = "com.atproto.moderation.defs#reasonSexual"
    case rude = "com.atproto.moderation.defs#reasonRude"
    case other = "com.atproto.moderation.defs#reasonOther"

    public var id: Self { self }
}

/// What a report is about: one post, or a whole account.
public enum ReportSubject: Sendable, Hashable {
    /// `com.atproto.repo.strongRef`.
    case record(StrongRef)
    /// `com.atproto.admin.defs#repoRef`.
    case account(did: String)
}

extension ReportSubject: Encodable {
    private enum CodingKeys: String, CodingKey {
        case type = "$type"
        case uri, cid, did
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case let .record(ref):
            try container.encode("com.atproto.repo.strongRef", forKey: .type)
            try container.encode(ref.uri, forKey: .uri)
            try container.encode(ref.cid, forKey: .cid)
        case let .account(did):
            try container.encode("com.atproto.admin.defs#repoRef", forKey: .type)
            try container.encode(did, forKey: .did)
        }
    }
}

/// Why a report can't be sent as written.
public enum ReportError: Error, Equatable, Sendable {
    case detailsTooLong(limit: Int)
}

/// Output of `com.atproto.moderation.createReport`. Only the ID is kept.
public struct CreateReportOutput: Decodable, Sendable, Equatable {
    public let id: Int
}

private struct CreateReportInput: Encodable {
    let reasonType: String
    let reason: String?
    let subject: ReportSubject
}

extension ATProtoSessionManager {
    public static let createReportNSID = "com.atproto.moderation.createReport"
    /// `reason.maxGraphemes` in the Lexicon.
    public static let maxReportDetailsGraphemes = 2000

    /// Files a report through the signed-in account's PDS.
    ///
    /// With `labeler`, the PDS forwards it to that labeler's moderation
    /// service (`atproto-proxy: <did>#atproto_labeler`). Without one, the PDS
    /// sends it to the moderation service it is configured with
    /// (`PDS_REPORT_SERVICE_URL` / `PDS_REPORT_SERVICE_DID`), and fails if it
    /// has none.
    public func createReport(
        subject: ReportSubject,
        reason: ReportReason,
        details: String? = nil,
        labeler: String? = nil
    ) async throws -> CreateReportOutput {
        guard let session else { throw ATProtoError.notSignedIn }
        let trimmed = details?.trimmingCharacters(in: .whitespacesAndNewlines)
        let detailsOrNil = trimmed?.isEmpty == false ? trimmed : nil
        if let detailsOrNil, detailsOrNil.count > Self.maxReportDetailsGraphemes {
            throw ReportError.detailsTooLong(limit: Self.maxReportDetailsGraphemes)
        }
        var request = try XRPC.procedureRequest(
            service: session.pdsURL,
            nsid: Self.createReportNSID,
            input: CreateReportInput(reasonType: reason.rawValue, reason: detailsOrNil, subject: subject)
        )
        if let labeler {
            request.setValue("\(labeler)#atproto_labeler", forHTTPHeaderField: "atproto-proxy")
        }
        return try XRPC.decode(try await authorizedSend(request), as: CreateReportOutput.self)
    }
}
