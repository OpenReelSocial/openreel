import Foundation
import Observation
import OpenReelATProto

/// The viewer's moderation state: their content-filter preferences (kept on
/// the device), the reels they chose to reveal this session, and reporting.
/// Label interpretation itself is `ModerationPolicy` in OpenReelATProto.
///
/// What the backend must provide for this to light up is in
/// `docs/architecture/moderation.md`.
@MainActor
@Observable
final class ModerationController {
    static let preferencesKey = "moderation.preferences"

    private(set) var preferences: ModerationPreferences
    /// Reels the viewer clicked through this session.
    private(set) var revealedIDs: Set<String> = []
    /// OpenReel's baseline labeler for this deployment (moderation layer 1),
    /// or `nil` until one is configured (`Backend.baselineLabelerDID`).
    let baselineLabelerDID: String?

    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private let auth: AuthController?

    init(auth: AuthController? = nil, baselineLabelerDID: String? = nil, defaults: UserDefaults = .standard) {
        self.auth = auth
        self.baselineLabelerDID = baselineLabelerDID
        self.defaults = defaults
        preferences = defaults.data(forKey: Self.preferencesKey)
            .flatMap { try? JSONDecoder().decode(ModerationPreferences.self, from: $0) } ?? .default
    }

    // MARK: - Preferences

    func visibility(for category: ContentCategory) -> ContentVisibility {
        preferences[category]
    }

    func setVisibility(_ visibility: ContentVisibility, for category: ContentCategory) {
        preferences[category] = visibility
        if let data = try? JSONEncoder().encode(preferences) {
            defaults.set(data, forKey: Self.preferencesKey)
        }
    }

    // MARK: - Decisions

    func decision(for reel: Reel) -> ModerationDecision {
        ModerationPolicy.decide(reel.moderationCauses, preferences: preferences)
    }

    func isHidden(_ reel: Reel) -> Bool {
        decision(for: reel).isHidden
    }

    /// Blurred and not yet revealed.
    func isCovered(_ reel: Reel) -> Bool {
        decision(for: reel).isCovered && !revealedIDs.contains(reel.id)
    }

    func reveal(_ reel: Reel) {
        revealedIDs.insert(reel.id)
    }

    /// Who applied a label, for the cover and badges.
    func sourceName(for cause: ModerationCause) -> String {
        if cause.isSelfLabel { return "the creator" }
        if cause.source == baselineLabelerDID { return "OpenReel Moderation" }
        return cause.source
    }

    // MARK: - Reporting

    var canReport: Bool { auth?.session != nil }

    /// Sends a report to the baseline labeler through the viewer's PDS, or
    /// to the PDS's own moderation service when no labeler is configured.
    func report(_ subject: ReportSubject, reason: ReportReason, details: String) async throws {
        guard let auth else { throw ATProtoError.notSignedIn }
        _ = try await auth.manager.createReport(
            subject: subject, reason: reason, details: details, labeler: baselineLabelerDID
        )
    }

    static func message(forReportError error: Error) -> String {
        switch error {
        case let ReportError.detailsTooLong(limit):
            return "Keep the details under \(limit) characters."
        case ATProtoError.sessionExpired, ATProtoError.notSignedIn:
            return "Sign in again to send reports."
        case let ATProtoError.xrpc(status, code, detail):
            // No moderation service behind the PDS yet, or the labeler is
            // unreachable: not something the viewer can fix.
            if status == 501 || code == "MethodNotImplemented" || status == 502 || code == "UpstreamFailure"
                || (detail ?? "").localizedCaseInsensitiveContains("moderation") {
                return "Reporting isn't set up on this server yet. Your report wasn't sent."
            }
            return "The server couldn't take the report: \(detail ?? code ?? "HTTP \(status)")."
        default:
            return UserFacingError.message(for: error)
        }
    }
}

extension ContentCategory {
    var title: String {
        switch self {
        case .adult: "Adult content"
        case .graphicViolence: "Graphic violence"
        case .misinformation: "Misinformation"
        case .spam: "Spam"
        }
    }

    var summary: String {
        switch self {
        case .adult: "Nudity and sexual content."
        case .graphicViolence: "Gore and violent imagery."
        case .misinformation: "Content a labeler flagged as misleading."
        case .spam: "Repetitive, low-quality, or unwanted content."
        }
    }

    var systemImage: String {
        switch self {
        case .adult: "eye.slash"
        case .graphicViolence: "exclamationmark.triangle"
        case .misinformation: "info.circle"
        case .spam: "trash"
        }
    }
}

extension ContentVisibility {
    func title(for category: ContentCategory) -> String {
        switch self {
        case .show: "Show"
        case .warn: category.warnsByBlurring ? "Blur" : "Label"
        case .hide: "Hide"
        }
    }
}

extension ModerationCause {
    /// A short, human name for the label.
    var title: String {
        if let category { return category.title }
        switch value {
        case LabelValue.warn: return "Content warning"
        case LabelValue.hide, LabelValue.takedown: return "Removed"
        default: return value
        }
    }
}

extension ReportReason {
    var title: String {
        switch self {
        case .spam: "Spam"
        case .violation: "Illegal or violates the rules"
        case .misleading: "Misleading or false"
        case .sexual: "Unwanted sexual content"
        case .rude: "Harassment or hate"
        case .other: "Something else"
        }
    }
}
