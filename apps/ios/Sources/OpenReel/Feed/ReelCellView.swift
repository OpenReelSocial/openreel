import AVFoundation
import SwiftUI

struct ReelCellView: View {
    let reel: Reel
    let player: AVPlayer?
    let isFocused: Bool
    let isPaused: Bool
    let hasFailed: Bool
    /// Height of the tab bar and home indicator the overlays must clear.
    var bottomInset: CGFloat = 0
    let onTap: () -> Void

    @State private var isLiked = false

    var body: some View {
        ZStack(alignment: .bottom) {
            HStack(alignment: .bottom, spacing: 12) {
                ReelInfoView(reel: reel)
                ReelActionRail(authorHandle: reel.authorHandle, isLiked: $isLiked)
            }
            .padding(.leading, 16)
            .padding(.trailing, 10)
            .padding(.bottom, 18)

            ReelProgressBar(player: isFocused ? player : nil)
        }
        .padding(.bottom, bottomInset)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
        .background {
            ZStack {
                ReelPlayerView(reel: reel, player: player)
                scrims
                status
            }
        }
        .contentShape(Rectangle())
        .onTapGesture(perform: onTap)
        .accessibilityAction(named: Text(isPaused ? "Play" : "Pause"), onTap)
    }

    @ViewBuilder
    private var status: some View {
        if hasFailed {
            Label("This video can't be played right now.", systemImage: "exclamationmark.triangle")
                .font(.subheadline)
                .foregroundStyle(MonoTheme.primary)
                .padding()
                .background(MonoTheme.scrim.opacity(0.6), in: RoundedRectangle(cornerRadius: 12))
        } else if isFocused && isPaused {
            Image(systemName: "play.fill")
                .font(.system(size: 56))
                .foregroundStyle(MonoTheme.primary.opacity(0.8))
                .accessibilityHidden(true)
        }
    }

    private var scrims: some View {
        VStack(spacing: 0) {
            LinearGradient(
                colors: [MonoTheme.scrim.opacity(0.8), .clear],
                startPoint: .top,
                endPoint: .bottom
            )
            .frame(height: 150)
            Spacer()
            LinearGradient(
                colors: [.clear, MonoTheme.scrim.opacity(0.9)],
                startPoint: .top,
                endPoint: .bottom
            )
            .frame(height: 320)
        }
        .allowsHitTesting(false)
    }
}

/// Thin playback position indicator along the bottom edge of a reel. Reads
/// the pooled player's clock; `nil` (an unfocused reel) shows an empty track.
struct ReelProgressBar: View {
    let player: AVPlayer?

    var body: some View {
        TimelineView(.periodic(from: .now, by: 0.1)) { _ in
            GeometryReader { geometry in
                ZStack(alignment: .leading) {
                    Rectangle().fill(MonoTheme.progressTrack)
                    Rectangle()
                        .fill(MonoTheme.accent)
                        .frame(width: geometry.size.width * progress)
                }
            }
        }
        .frame(height: 2)
        .accessibilityHidden(true)
    }

    private var progress: Double {
        guard let player, let duration = player.currentItem?.duration.seconds,
              duration.isFinite, duration > 0
        else { return 0 }
        return min(max(player.currentTime().seconds / duration, 0), 1)
    }
}
