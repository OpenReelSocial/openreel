import AVFoundation
import SwiftUI

struct ReelCellView: View {
    let reel: Reel
    let player: AVPlayer?
    let isFocused: Bool
    let isPaused: Bool
    let hasFailed: Bool
    let onTap: () -> Void

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            ReelPlayerView(reel: reel, player: player)

            if hasFailed {
                Label("This video can't be played right now.", systemImage: "exclamationmark.triangle")
                    .font(.subheadline)
                    .foregroundStyle(.white)
                    .padding()
                    .background(.black.opacity(0.6), in: RoundedRectangle(cornerRadius: 12))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if isFocused && isPaused {
                Image(systemName: "play.fill")
                    .font(.system(size: 56))
                    .foregroundStyle(.white.opacity(0.8))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .accessibilityHidden(true)
            }

            details
        }
        .contentShape(Rectangle())
        .onTapGesture(perform: onTap)
        .accessibilityAction(named: Text(isPaused ? "Play" : "Pause"), onTap)
    }

    private var details: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(reel.authorHandle)
                .font(.headline)
            if !reel.caption.isEmpty {
                Text(reel.caption)
                    .font(.subheadline)
                    .lineLimit(3)
            }
            if !reel.tags.isEmpty {
                Text(reel.tags.map { "#\($0)" }.joined(separator: " "))
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
            }
        }
        .foregroundStyle(.white)
        .padding()
        // Clear of the home indicator; the feed ignores the safe area.
        .padding(.bottom, 24)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            LinearGradient(
                colors: [.black.opacity(0.65), .clear],
                startPoint: .bottom,
                endPoint: .top
            )
        )
    }
}
