import SwiftUI
import UIKit

/// Invisible touch-and-hold areas along the left and right edges of a reel.
///
/// Hold either edge to play at 2×. Without lifting, swipe down to lock 2× on,
/// or swipe up to drop back to 1×; a locked reel is released the same way,
/// by holding again and swiping up. A swipe that starts moving before the
/// hold registers still pages the feed, and a tap still pauses.
///
/// The hold is a UIKit long press rather than a SwiftUI long press sequenced
/// into a drag: SwiftUI treats that sequence as a drag from the first touch,
/// which stops the feed's scroll view from paging, while a long press simply
/// fails once the finger moves. Bridging UIKit recognizers needs iOS 18.
@available(iOS 18.0, *)
struct ReelSpeedZones: View {
    let onHold: (Bool) -> Void
    let onLock: (Bool) -> Void

    /// Share of the reel's width each edge zone covers.
    private static let widthFraction = 0.28

    var body: some View {
        GeometryReader { geometry in
            HStack(spacing: 0) {
                zone.frame(width: geometry.size.width * Self.widthFraction)
                Spacer(minLength: 0)
                zone.frame(width: geometry.size.width * Self.widthFraction)
            }
        }
        .accessibilityHidden(true)
    }

    private var zone: some View {
        Color.clear
            .contentShape(Rectangle())
            .gesture(SpeedHoldGesture(onHold: onHold, onLock: onLock))
    }
}

/// A long press that reports the hold, then each swipe down (lock) or up
/// (release) the finger makes before lifting.
@available(iOS 18.0, *)
private struct SpeedHoldGesture: UIGestureRecognizerRepresentable {
    let onHold: (Bool) -> Void
    let onLock: (Bool) -> Void

    private static let holdDuration: TimeInterval = 0.3
    /// Vertical travel during a hold that counts as a swipe.
    private static let swipeDistance: CGFloat = 50

    final class Coordinator {
        var start: CGPoint = .zero
        /// The last lock or release this hold sent, so each swipe sends once.
        var lastLock: Bool?
    }

    func makeCoordinator(converter: CoordinateSpaceConverter) -> Coordinator {
        Coordinator()
    }

    func makeUIGestureRecognizer(context: Context) -> UILongPressGestureRecognizer {
        let recognizer = UILongPressGestureRecognizer()
        recognizer.minimumPressDuration = Self.holdDuration
        return recognizer
    }

    func handleUIGestureRecognizerAction(_ recognizer: UILongPressGestureRecognizer, context: Context) {
        let location = recognizer.location(in: recognizer.view)
        let coordinator = context.coordinator
        switch recognizer.state {
        case .began:
            coordinator.start = location
            coordinator.lastLock = nil
            onHold(true)
        case .changed:
            guard let lock = Self.lock(forVerticalTravel: location.y - coordinator.start.y),
                  lock != coordinator.lastLock
            else { return }
            coordinator.lastLock = lock
            onLock(lock)
        case .ended, .cancelled:
            onHold(false)
        default:
            break
        }
    }

    /// `true` (lock) for a swipe down, `false` (release) for a swipe up, or
    /// `nil` while the finger is still near where the hold began.
    static func lock(forVerticalTravel travel: CGFloat) -> Bool? {
        if travel > swipeDistance { return true }
        if travel < -swipeDistance { return false }
        return nil
    }
}

/// Shows that the reel is playing at 2×, with how to lock or release it.
struct ReelSpeedBadge: View {
    let isHeld: Bool
    let isLocked: Bool

    var body: some View {
        VStack(spacing: 2) {
            Label(isLocked ? "2× locked" : "2×", systemImage: isLocked ? "lock.fill" : "forward.fill")
                .font(.caption.weight(.semibold))
            if let hint {
                Text(hint)
                    .font(.caption2)
                    .foregroundStyle(MonoTheme.overlayText)
            }
        }
        .foregroundStyle(MonoTheme.primary)
        // No backing, so a shadow keeps it legible on bright video.
        .shadow(color: MonoTheme.scrim.opacity(0.6), radius: 3)
        .allowsHitTesting(false)
        .accessibilityElement(children: .combine)
    }

    private var hint: String? {
        switch (isHeld, isLocked) {
        case (true, false): "Swipe down to lock"
        case (true, true): "Swipe up to release"
        case (false, _): nil
        }
    }
}
