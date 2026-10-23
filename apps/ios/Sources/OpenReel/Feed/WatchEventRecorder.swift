import Foundation
import OpenReelATProto

/// Publishes finished watches as `social.openreel.engagement.watchEvent`
/// records in the viewer's own repository, which is where feeds ranked by
/// views get their view counts. Repositories are public, so nothing is
/// written unless the viewer has turned on sharing (Profile > Engagement).
@MainActor
final class WatchEventRecorder {
    /// `UserDefaults` key of the opt-in. Off unless the viewer turns it on.
    static let sharingKey = "shareWatchHistory"
    /// A shorter watch is a scroll past, not a view.
    static let minimumWatchMs = 2_000

    private let auth: AuthController

    init(auth: AuthController) {
        self.auth = auth
    }

    func record(_ watch: WatchSession) {
        guard UserDefaults.standard.bool(forKey: Self.sharingKey),
              auth.session != nil,
              watch.watchedMs >= Self.minimumWatchMs
        else { return }

        let record = WatchEventRecord(
            subject: StrongRef(uri: watch.reel.id, cid: watch.reel.cid),
            watchDurationMs: watch.watchedMs,
            videoDurationMs: watch.videoDurationMs,
            // The feed has no mute control; clips always play with sound.
            soundEnabled: true,
            rewatchCount: watch.rewatchCount,
            context: "feed"
        )
        let manager = auth.manager
        let uri = watch.reel.id
        Task {
            do {
                _ = try await manager.createRecord(collection: WatchEventRecord.collection, record: record)
            } catch {
                // A lost view is not worth interrupting the viewer over.
                print("[watch] could not publish watch of \(uri): \(error)")
            }
        }
    }
}
