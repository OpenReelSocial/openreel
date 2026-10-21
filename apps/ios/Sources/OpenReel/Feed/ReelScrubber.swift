import AVFoundation
import SwiftUI

/// The playback position along the bottom edge of a reel, and the handle for
/// scrubbing it.
///
/// Drag sideways along the bar to move through the video: the bar thickens,
/// grows a thumb, and shows the elapsed and total time above it. Playback
/// follows the finger relative to where the drag began, so touching the bar
/// never jumps. A drag that starts out vertical is ignored. VoiceOver adjusts
/// the position in steps instead.
struct ReelScrubber: View {
    /// The focused reel's player; `nil` shows an empty track and ignores drags.
    let player: AVPlayer?
    let onScrub: (ScrubEvent) -> Void

    /// Where the drag has moved playback to, shown instead of the player's
    /// clock so the bar keeps up with the finger. `nil` when not scrubbing.
    @State private var dragFraction: Double?
    @State private var dragStartFraction: Double?
    /// The current drag started out vertical and is ignored until it ends.
    @State private var isIgnoringDrag = false
    /// Resets on end and on cancellation, unlike `onEnded`.
    @GestureState private var isDragging = false

    /// Touch target height; the visible bar sits along its bottom edge.
    static let height: CGFloat = 24
    private static let barHeight: CGFloat = 2
    private static let scrubbingBarHeight: CGFloat = 5
    private static let thumbSize: CGFloat = 12
    private static let accessibilityStep: TimeInterval = 5

    var body: some View {
        GeometryReader { geometry in
            TimelineView(.periodic(from: .now, by: 0.1)) { _ in
                bar(width: geometry.size.width)
            }
            .frame(maxHeight: .infinity, alignment: .bottom)
            .contentShape(Rectangle())
            .gesture(drag(width: geometry.size.width))
        }
        .frame(height: Self.height)
        .overlay(alignment: .bottom) {
            if let dragFraction, let duration {
                timeLabel(elapsed: dragFraction * duration, duration: duration)
            }
        }
        .animation(.easeOut(duration: 0.15), value: dragFraction != nil)
        .onChange(of: isDragging) { _, dragging in
            if !dragging { finishDrag() }
        }
        .accessibilityElement()
        .accessibilityHidden(duration == nil)
        .accessibilityLabel("Playback position")
        .accessibilityValue(accessibilityValue)
        .accessibilityAdjustableAction { direction in
            guard let duration else { return }
            let step = direction == .increment ? Self.accessibilityStep : -Self.accessibilityStep
            onScrub(.ended(at: min(max(progress * duration + step, 0), duration)))
        }
    }

    private func bar(width: CGFloat) -> some View {
        let fraction = dragFraction ?? progress
        let isScrubbing = dragFraction != nil
        return ZStack(alignment: .leading) {
            Rectangle().fill(MonoTheme.progressTrack)
            Rectangle()
                .fill(MonoTheme.accent)
                .frame(width: width * fraction)
        }
        .frame(height: isScrubbing ? Self.scrubbingBarHeight : Self.barHeight)
        .overlay(alignment: .leading) {
            if isScrubbing {
                Circle()
                    .fill(MonoTheme.accent)
                    .frame(width: Self.thumbSize, height: Self.thumbSize)
                    .offset(x: width * fraction - Self.thumbSize / 2)
            }
        }
    }

    private func timeLabel(elapsed: TimeInterval, duration: TimeInterval) -> some View {
        (Text(Self.timestamp(elapsed)) + Text(" / \(Self.timestamp(duration))").foregroundStyle(MonoTheme.secondary))
            .font(.title3.weight(.semibold).monospacedDigit())
            .foregroundStyle(MonoTheme.primary)
            .fixedSize()
            .padding(.bottom, 64)
            .allowsHitTesting(false)
            .transition(.opacity)
    }

    private func drag(width: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 6)
            .updating($isDragging) { _, state, _ in state = true }
            .onChanged { value in
                guard !isIgnoringDrag, let duration else { return }
                let start: Double
                if let dragStartFraction {
                    start = dragStartFraction
                } else {
                    guard abs(value.translation.width) > abs(value.translation.height) else {
                        isIgnoringDrag = true
                        return
                    }
                    start = progress
                    dragStartFraction = start
                    onScrub(.began)
                }
                let fraction = Self.fraction(from: start, translation: value.translation.width, width: width)
                dragFraction = fraction
                onScrub(.moved(to: fraction * duration))
            }
    }

    private func finishDrag() {
        if let dragFraction, let duration {
            onScrub(.ended(at: dragFraction * duration))
        }
        dragFraction = nil
        dragStartFraction = nil
        isIgnoringDrag = false
    }

    private var duration: TimeInterval? {
        guard let seconds = player?.currentItem?.duration.seconds, seconds.isFinite, seconds > 0
        else { return nil }
        return seconds
    }

    private var progress: Double {
        guard let player, let duration else { return 0 }
        return min(max(player.currentTime().seconds / duration, 0), 1)
    }

    private var accessibilityValue: String {
        guard let duration else { return "" }
        return "\(Self.spokenDuration(progress * duration)) of \(Self.spokenDuration(duration))"
    }

    /// Playback position, as a fraction of the clip, after a drag that began
    /// at `start` has moved `translation` points along a bar `width` wide.
    static func fraction(from start: Double, translation: CGFloat, width: CGFloat) -> Double {
        guard width > 0 else { return start }
        return min(max(start + translation / width, 0), 1)
    }

    /// `m:ss`, e.g. `0:07` or `1:30`.
    static func timestamp(_ seconds: TimeInterval) -> String {
        let whole = Int(seconds.rounded())
        return String(format: "%d:%02d", whole / 60, whole % 60)
    }

    private static func spokenDuration(_ seconds: TimeInterval) -> String {
        Duration.seconds(Int(seconds.rounded()))
            .formatted(.units(allowed: [.minutes, .seconds], width: .wide))
    }
}
