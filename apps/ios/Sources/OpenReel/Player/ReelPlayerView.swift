import AVFoundation
import SwiftUI

/// One reel's video surface: the poster until the pooled player has a frame,
/// then the video. The player's lifecycle belongs to `FeedPlaybackController`;
/// this view only attaches it to a layer.
struct ReelPlayerView: View {
    let reel: Reel
    let player: AVPlayer?

    @State private var isShowingVideo = false

    var body: some View {
        ZStack {
            Color.black
            poster
            if let player {
                HLSPlayerView(
                    player: player,
                    videoGravity: reel.fillsScreen ? .resizeAspectFill : .resizeAspect,
                    onReadyForDisplayChange: { isShowingVideo = $0 }
                )
                .opacity(isShowingVideo ? 1 : 0)
            }
        }
        .onChange(of: player) { _, _ in isShowingVideo = false }
        .clipped()
        .accessibilityElement()
        .accessibilityLabel(reel.accessibilityLabel ?? "Video by \(reel.authorHandle)")
    }

    private var poster: some View {
        // Overlay on a greedy clear view so a filled poster cannot push the
        // cell past the screen.
        Color.clear.overlay {
            AsyncImage(url: reel.posterURL) { phase in
                if let image = phase.image {
                    if reel.fillsScreen {
                        image.resizable().scaledToFill()
                    } else {
                        image.resizable().scaledToFit()
                    }
                } else {
                    Color.black
                }
            }
        }
    }
}
