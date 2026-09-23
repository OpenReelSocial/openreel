import SwiftUI

struct ReelCellView: View {
    let reel: Reel
    let isActive: Bool
    /// Height of the tab bar and home indicator the overlays must clear.
    var bottomInset: CGFloat = 0

    @State private var progress: Double = 0
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

            ReelProgressBar(progress: progress)
        }
        .padding(.bottom, bottomInset)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
        .background {
            ZStack {
                ReelPlayerView(url: reel.videoURL, isActive: isActive, progress: $progress)
                scrims
            }
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

/// Thin playback position indicator along the bottom edge of a reel.
struct ReelProgressBar: View {
    let progress: Double

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .leading) {
                Rectangle().fill(MonoTheme.progressTrack)
                Rectangle()
                    .fill(MonoTheme.accent)
                    .frame(width: geometry.size.width * min(max(progress, 0), 1))
            }
        }
        .frame(height: 2)
        .accessibilityHidden(true)
    }
}
