import AVFoundation
import OpenReelATProto
import SwiftUI

struct ReelCellView: View {
    let reel: Reel
    let player: AVPlayer?
    let isFocused: Bool
    let isPaused: Bool
    let hasFailed: Bool
    /// The viewer is dragging this reel's progress bar.
    var isScrubbing = false
    var isSpeedLocked = false
    /// Height of the tab bar and home indicator the overlays must clear.
    var bottomInset: CGFloat = 0
    let onTap: () -> Void
    var onScrub: (ScrubEvent) -> Void = { _ in }
    var onSpeedHold: (Bool) -> Void = { _ in }
    var onSpeedLock: (Bool) -> Void = { _ in }
    var isLiked = false
    var likeCount = 0
    var onToggleLike: () -> Void = {}
    var onAction: (ReelAction) -> Void = { _ in }
    /// What the viewer's moderation preferences make of the reel's labels.
    var moderation: ModerationDecision = .none
    /// Blurred behind a cover the viewer hasn't tapped through.
    var isCovered = false
    var sourceName: (ModerationCause) -> String = { $0.source }
    var onReveal: () -> Void = {}

    var body: some View {
        ZStack(alignment: .bottom) {
            HStack(alignment: .bottom, spacing: 12) {
                ReelInfoView(reel: reel, badges: badges)
                VStack(spacing: -6) {
                    ReelHeartButton(isLiked: isLiked, onToggleLike: onToggleLike, onAction: onAction)
                        .accessibilityValue(likeCount == 1 ? "1 like" : "\(likeCount) likes")
                    Text(likeCount, format: .number.notation(.compactName))
                        .font(.footnote.weight(.semibold).monospacedDigit())
                        .foregroundStyle(MonoTheme.primary)
                        .shadow(color: MonoTheme.scrim.opacity(0.6), radius: 2)
                        .contentTransition(.numericText(value: Double(likeCount)))
                        .animation(.snappy, value: likeCount)
                        .accessibilityHidden(true)
                }
            }
            .padding(.leading, 16)
            .padding(.trailing, 10)
            // Clears the scrubber's touch target.
            .padding(.bottom, ReelScrubber.height)
            // Out of the way so the frame being scrubbed to is visible.
            .opacity(isScrubbing ? 0 : 1)
            .allowsHitTesting(!isScrubbing)

            ReelScrubber(player: isFocused ? player : nil, onScrub: onScrub)
        }
        // Nothing of a covered reel shows until the viewer chooses to see it.
        .opacity(isCovered ? 0 : 1)
        .allowsHitTesting(!isCovered)
        .animation(.easeOut(duration: 0.2), value: isScrubbing)
        .padding(.bottom, bottomInset)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
        .background {
            ZStack {
                ReelPlayerView(reel: reel, player: player)
                    .blur(radius: isCovered ? 60 : 0, opaque: true)
                scrims
                status
                if #available(iOS 18.0, *) {
                    ReelSpeedZones(onHold: onSpeedHold, onLock: onSpeedLock)
                }
            }
        }
        .contentShape(Rectangle())
        .onTapGesture(perform: onTap)
        .overlay {
            if isCovered {
                ModerationCoverView(causes: moderation.coverCauses, sourceName: sourceName, onReveal: onReveal)
                    .transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.25), value: isCovered)
        .accessibilityAction(named: Text(isPaused ? "Play" : "Pause"), onTap)
        .accessibilityAction(named: Text(isSpeedLocked ? "Play at normal speed" : "Play at double speed")) {
            onSpeedLock(!isSpeedLocked)
        }
    }

    private var badges: [ReelBadge] {
        moderation.badges.map { ReelBadge(name: $0.title, labeler: sourceName($0)) }
    }

    @ViewBuilder
    private var status: some View {
        if isCovered {
            EmptyView()
        } else if hasFailed {
            Label("This video can't be played right now.", systemImage: "exclamationmark.triangle")
                .font(.subheadline)
                .foregroundStyle(MonoTheme.primary)
                .padding()
                .background(MonoTheme.scrim.opacity(0.6), in: RoundedRectangle(cornerRadius: 12))
        } else if isFocused && isPaused && !isScrubbing {
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
