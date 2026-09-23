import AVFoundation
import SwiftUI

/// Owns one AVPlayer's lifecycle for a single feed cell: loops on end, and
/// plays/pauses as the cell scrolls in and out of view, and reports playback
/// position as a 0...1 fraction.
struct ReelPlayerView: View {
    let url: URL
    let isActive: Bool
    @Binding var progress: Double

    @State private var player: AVPlayer?
    @State private var loopObserver: NSObjectProtocol?
    @State private var timeObserver: Any?

    var body: some View {
        Group {
            if let player {
                HLSPlayerView(player: player)
            } else {
                Color.black
            }
        }
        .onAppear(perform: preparePlayerIfNeeded)
        .onDisappear(perform: teardownPlayer)
        .onChange(of: isActive) { _, active in
            active ? player?.play() : player?.pause()
        }
    }

    private func preparePlayerIfNeeded() {
        guard player == nil else { return }

        let item = AVPlayerItem(url: url)
        let newPlayer = AVPlayer(playerItem: item)
        newPlayer.actionAtItemEnd = .none

        loopObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: item,
            queue: .main
        ) { [weak newPlayer] _ in
            newPlayer?.seek(to: .zero)
            newPlayer?.play()
        }

        timeObserver = newPlayer.addPeriodicTimeObserver(
            forInterval: CMTime(value: 1, timescale: 10),
            queue: .main
        ) { [weak newPlayer] time in
            guard let duration = newPlayer?.currentItem?.duration.seconds,
                  duration.isFinite, duration > 0 else { return }
            progress = time.seconds / duration
        }

        player = newPlayer
        if isActive {
            newPlayer.play()
        }
    }

    private func teardownPlayer() {
        player?.pause()
        if let timeObserver {
            player?.removeTimeObserver(timeObserver)
        }
        timeObserver = nil
        progress = 0
        if let loopObserver {
            NotificationCenter.default.removeObserver(loopObserver)
        }
        loopObserver = nil
        player = nil
    }
}
