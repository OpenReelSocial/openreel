import AVFoundation
import SwiftUI

/// Owns one AVPlayer's lifecycle for a single feed cell: loops on end, and
/// plays/pauses as the cell scrolls in and out of view.
struct ReelPlayerView: View {
    let url: URL
    let isActive: Bool

    @State private var player: AVPlayer?
    @State private var loopObserver: NSObjectProtocol?

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

        player = newPlayer
        if isActive {
            newPlayer.play()
        }
    }

    private func teardownPlayer() {
        player?.pause()
        if let loopObserver {
            NotificationCenter.default.removeObserver(loopObserver)
        }
        loopObserver = nil
        player = nil
    }
}
