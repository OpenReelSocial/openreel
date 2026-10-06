import AVFoundation
import Observation

/// Owns every `AVPlayer` in the feed and implements directional preloading
/// (project plan §5.7.5):
///
/// - the focused reel and the next `preloadAhead` reels get a player with an
///   item attached, so HLS playlist and first-segment fetches start before the
///   viewer swipes;
/// - `keepBehind` reels stay loaded so a swipe back is also instant;
/// - everything else has its item released, and its player goes back to a
///   small pool for reuse.
///
/// Only the focused player ever plays, and every other player is paused
/// before it starts, which is what prevents audio bleed between clips.
@MainActor
@Observable
final class FeedPlaybackController {
    static let preloadAhead = 2
    static let keepBehind = 1
    /// Seconds of media a preloaded (not yet visible) item may buffer. Enough
    /// for an instant start without downloading whole clips nobody watches.
    static let preloadBufferDuration: TimeInterval = 4

    /// Why playback is held. The feed plays only when this is empty.
    enum Suspension: Hashable {
        case background
        case covered
        case hidden
    }

    /// Players by reel ID. Cells read this to attach a player layer.
    private(set) var players: [String: AVPlayer] = [:]
    private(set) var focusedID: String?
    /// The viewer tapped to pause the focused reel. Cleared on swipe.
    private(set) var isPausedByUser = false
    /// Reels whose item failed to load, so the cell can say so.
    private(set) var failedIDs: Set<String> = []

    @ObservationIgnored private var suspensions: Set<Suspension> = []
    @ObservationIgnored private var observers: [String: ItemObservers] = [:]
    @ObservationIgnored private var spares: [AVPlayer] = []
    @ObservationIgnored private var audioSessionActive = false

    private struct ItemObservers {
        let loop: NSObjectProtocol
        let status: NSKeyValueObservation
        /// Debug-only logging; see `diagnostics(for:player:id:)`.
        var notifications: [NSObjectProtocol] = []
        var observations: [NSKeyValueObservation] = []
    }

    /// Focuses the reel at `index` and moves the preload window with it.
    func focus(on index: Int, in reels: [Reel]) {
        guard reels.indices.contains(index) else { return }
        let focused = reels[index]

        if focused.id != focusedID {
            isPausedByUser = false
        }
        // Pause the outgoing clip before anything else can start.
        for (id, player) in players where id != focused.id {
            player.pause()
        }

        let window = Self.window(around: index, count: reels.count).map { reels[$0] }
        let wanted = Set(window.map(\.id))
        for id in Array(players.keys) where !wanted.contains(id) {
            release(id)
        }
        // `window` lists the focused reel first, so it is loaded first.
        for reel in window where players[reel.id] == nil {
            load(reel)
        }
        for (id, player) in players {
            // 0 lets AVFoundation pick the buffer for the clip being watched.
            player.currentItem?.preferredForwardBufferDuration = id == focused.id ? 0 : Self.preloadBufferDuration
        }

        focusedID = focused.id
        updatePlayback()
    }

    /// Indices to keep loaded around `index`, in load-priority order: the
    /// focused reel, then ahead, then behind.
    static func window(around index: Int, count: Int) -> [Int] {
        guard count > 0, (0..<count).contains(index) else { return [] }
        let ahead = (index + 1)..<min(count, index + 1 + preloadAhead)
        let behind = max(0, index - keepBehind)..<index
        return [index] + Array(ahead) + behind.reversed()
    }

    func togglePause() {
        isPausedByUser.toggle()
        updatePlayback()
    }

    func suspend(_ reason: Suspension) {
        suspensions.insert(reason)
        updatePlayback()
    }

    func resume(_ reason: Suspension) {
        suspensions.remove(reason)
        updatePlayback()
    }

    /// Drops every player, e.g. when the feed is replaced wholesale.
    func releaseAll() {
        for id in Array(players.keys) {
            release(id)
        }
        focusedID = nil
        updatePlayback()
    }

    // MARK: - Players

    private func load(_ reel: Reel) {
        let player = spares.popLast() ?? Self.makePlayer()
        let item = AVPlayerItem(url: reel.videoURL)
        item.preferredForwardBufferDuration = Self.preloadBufferDuration
        player.replaceCurrentItem(with: item)

        let id = reel.id
        failedIDs.remove(id)
        let loop = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: item,
            queue: .main
        ) { [weak player] _ in
            // Only the focused player plays, so only it reaches the end.
            player?.seek(to: .zero)
            player?.play()
        }
        let status = item.observe(\.status, options: [.new]) { [weak self] item, _ in
            guard item.status == .failed else { return }
            let message = item.error?.localizedDescription ?? "unknown error"
            Task { @MainActor in
                print("[playback] \(id) failed: \(message)")
                self?.failedIDs.insert(id)
            }
        }
        var itemObservers = ItemObservers(loop: loop, status: status)
        #if DEBUG
        (itemObservers.notifications, itemObservers.observations) = Self.diagnostics(for: item, player: player, id: id)
        #endif
        observers[id] = itemObservers
        players[id] = player
    }

    #if DEBUG
    /// Logs what AVFoundation is doing with each item (status, why the player
    /// is waiting, stalls, HLS error-log entries, the variant chosen) so a
    /// clip that will not play explains itself in the Xcode console.
    private static func diagnostics(for item: AVPlayerItem, player: AVPlayer, id: String) -> ([NSObjectProtocol], [NSKeyValueObservation]) {
        let name = id.split(separator: "/").last.map(String.init) ?? id
        func log(_ message: String) { print("[playback] \(name): \(message)") }

        let center = NotificationCenter.default
        let notifications = [
            center.addObserver(forName: .AVPlayerItemNewErrorLogEntry, object: item, queue: .main) { _ in
                guard let event = item.errorLog()?.events.last else { return }
                log("HLS error \(event.errorStatusCode) \(event.errorDomain): \(event.errorComment ?? "") \(event.uri ?? "")")
            },
            center.addObserver(forName: .AVPlayerItemNewAccessLogEntry, object: item, queue: .main) { _ in
                guard let event = item.accessLog()?.events.last else { return }
                log("variant \(event.indicatedBitrate) bps, \(event.numberOfStalls) stalls, \(event.numberOfDroppedVideoFrames) dropped, \(event.uri ?? "")")
            },
            center.addObserver(forName: .AVPlayerItemPlaybackStalled, object: item, queue: .main) { _ in
                log("stalled")
            },
            center.addObserver(forName: .AVPlayerItemFailedToPlayToEndTime, object: item, queue: .main) { note in
                log("failed to play to end: \(String(describing: note.userInfo?[AVPlayerItemFailedToPlayToEndTimeErrorKey]))")
            },
        ]
        let observations = [
            item.observe(\.status, options: [.new]) { item, _ in
                log("item status \(item.status.rawValue)\(item.error.map { " error: \($0)" } ?? "")")
            },
            player.observe(\.timeControlStatus, options: [.new]) { [weak item] player, _ in
                // The player is pooled; ignore it once it has moved on.
                guard let item, player.currentItem === item else { return }
                let reason = player.reasonForWaitingToPlay?.rawValue ?? "-"
                log("timeControlStatus \(player.timeControlStatus.rawValue) (0 paused, 1 waiting, 2 playing), waiting: \(reason)")
            },
        ]
        return (notifications, observations)
    }
    #endif

    private func release(_ id: String) {
        guard let player = players.removeValue(forKey: id) else { return }
        player.pause()
        player.replaceCurrentItem(with: nil)
        if let observers = observers.removeValue(forKey: id) {
            NotificationCenter.default.removeObserver(observers.loop)
            observers.status.invalidate()
            observers.notifications.forEach { NotificationCenter.default.removeObserver($0) }
            observers.observations.forEach { $0.invalidate() }
        }
        if spares.count < Self.preloadAhead {
            spares.append(player)
        }
    }

    private static func makePlayer() -> AVPlayer {
        let player = AVPlayer()
        player.actionAtItemEnd = .none
        return player
    }

    private func updatePlayback() {
        guard let focusedID, let player = players[focusedID] else {
            deactivateAudioSession()
            return
        }
        #if DEBUG
        print("[playback] focus \(focusedID.split(separator: "/").last ?? ""): suspensions \(suspensions), pausedByUser \(isPausedByUser), \(players.count) loaded")
        #endif
        if suspensions.isEmpty, !isPausedByUser {
            activateAudioSession()
            player.play()
        } else {
            player.pause()
            if !suspensions.isEmpty {
                deactivateAudioSession()
            }
        }
    }

    // MARK: - Audio session

    /// `.playback` so clips are audible with the ring/silent switch on, as in
    /// other video apps. The session is activated once while the feed plays
    /// rather than toggled per swipe as the plan's pseudocode does:
    /// deactivating while audio is running fails and delays every swipe, and
    /// pausing the outgoing player is what actually stops bleed.
    private func activateAudioSession() {
        guard !audioSessionActive else { return }
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playback, mode: .moviePlayback)
            try session.setActive(true)
            audioSessionActive = true
        } catch {
            print("[playback] could not activate audio session: \(error)")
        }
    }

    /// Lets other apps' audio resume while the feed is backgrounded or hidden.
    private func deactivateAudioSession() {
        guard audioSessionActive else { return }
        for player in players.values {
            player.pause()
        }
        do {
            try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        } catch {
            print("[playback] could not deactivate audio session: \(error)")
        }
        audioSessionActive = false
    }
}
