import SwiftUI

/// Invisible touch-and-hold areas along the left and right edges of a reel.
///
/// Hold either edge to play at 2×. Without lifting, swipe down to lock 2× on,
/// or swipe up to drop back to 1×; a locked reel is released the same way,
/// by holding again and swiping up. The middle of the reel is left to the
/// cell's tap-to-pause.
struct ReelSpeedZones: View {
    let onHold: (Bool) -> Void
    let onLock: (Bool) -> Void

    /// Resets on end and on cancellation, unlike `onEnded`.
    @GestureState private var isHolding = false
    /// The last lock or release this hold sent, so each swipe sends once.
    @State private var lastLock: Bool?

    /// Share of the reel's width each edge zone covers.
    private static let widthFraction = 0.28
    private static let holdDuration = 0.3
    /// Vertical travel during a hold that counts as a swipe.
    private static let swipeDistance: CGFloat = 50

    var body: some View {
        GeometryReader { geometry in
            HStack(spacing: 0) {
                zone.frame(width: geometry.size.width * Self.widthFraction)
                Spacer(minLength: 0)
                zone.frame(width: geometry.size.width * Self.widthFraction)
            }
        }
        .onChange(of: isHolding) { _, holding in
            onHold(holding)
            lastLock = nil
        }
        .sensoryFeedback(.impact(weight: .light), trigger: isHolding) { _, holding in holding }
        .sensoryFeedback(.impact(weight: .medium), trigger: lastLock) { _, lock in lock != nil }
        .accessibilityHidden(true)
    }

    private var zone: some View {
        Color.clear
            .contentShape(Rectangle())
            .gesture(hold)
    }

    private var hold: some Gesture {
        LongPressGesture(minimumDuration: Self.holdDuration)
            .sequenced(before: DragGesture(minimumDistance: 0))
            .updating($isHolding) { value, state, _ in
                // `.second` begins once the long press has succeeded.
                if case .second(true, _) = value { state = true }
            }
            .onChanged { value in
                guard case let .second(true, drag?) = value,
                      let lock = Self.lock(forVerticalTravel: drag.translation.height),
                      lock != lastLock
                else { return }
                lastLock = lock
                onLock(lock)
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
/// Tapping it while locked returns to 1×.
struct ReelSpeedBadge: View {
    let isHeld: Bool
    let isLocked: Bool
    let onRelease: () -> Void

    var body: some View {
        Button(action: onRelease) {
            VStack(spacing: 4) {
                Label(isLocked ? "2× locked" : "2×", systemImage: isLocked ? "lock.fill" : "forward.fill")
                    .font(.subheadline.weight(.semibold))
                if let hint {
                    Text(hint)
                        .font(.caption)
                        .foregroundStyle(MonoTheme.overlayText)
                }
            }
            .foregroundStyle(MonoTheme.primary)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(MonoTheme.scrim.opacity(0.55), in: RoundedRectangle(cornerRadius: 14))
        }
        .buttonStyle(.plain)
        .disabled(!isLocked)
        .accessibilityLabel(isLocked ? "Playing at double speed, locked" : "Playing at double speed")
        .accessibilityHint(isLocked ? "Plays at normal speed." : "")
    }

    private var hint: String? {
        switch (isHeld, isLocked) {
        case (true, false): "Swipe down to lock"
        case (true, true): "Swipe up to release"
        case (false, _): nil
        }
    }
}
