import SwiftUI

/// The secondary actions tucked behind the heart, nearest the heart first.
enum ReelAction: CaseIterable, Identifiable {
    case reply
    case repost
    case share
    case showLess

    var id: Self { self }

    var title: String {
        switch self {
        case .reply: "Reply"
        case .repost: "Repost"
        case .share: "Share"
        case .showLess: "Show less"
        }
    }

    var systemImage: String {
        switch self {
        case .reply: "bubble.right"
        case .repost: "arrow.2.squarepath"
        case .share: "square.and.arrow.up"
        case .showLess: "eye.slash"
        }
    }
}

/// The reel's only visible control: a heart in the bottom-right corner.
///
/// Tap it to like. Touch and hold, or start sliding up, to fan the other
/// actions out above it; slide onto one and let go to choose it, or let go
/// anywhere else to cancel. VoiceOver gets the same actions as a list.
/// Actions other than the local like toggle are not wired up yet.
struct ReelHeartButton: View {
    @Binding var isLiked: Bool
    var onAction: (ReelAction) -> Void = { _ in }

    @State private var isPressing = false
    @State private var isOpen = false
    @State private var highlighted: ReelAction?
    @State private var holdTask: Task<Void, Never>?

    private static let heartSize: CGFloat = 56
    private static let itemSize: CGFloat = 50
    /// Distance between the centers of neighboring items, heart included.
    private static let spacing: CGFloat = 62
    private static let holdDuration: Duration = .milliseconds(250)
    /// Upward travel that opens the menu without waiting for the hold.
    private static let slideToOpen: CGFloat = 14
    /// Movement under which a release still counts as a tap.
    private static let tapSlop: CGFloat = 10

    var body: some View {
        heart
            .overlay(alignment: .bottomTrailing) {
                if isOpen {
                    menu
                }
            }
            .contentShape(Rectangle())
            .highPriorityGesture(press)
            .animation(.spring(duration: 0.25), value: isOpen)
            .animation(.spring(duration: 0.2), value: highlighted)
            .sensoryFeedback(.impact(weight: .medium), trigger: isOpen) { _, open in open }
            .sensoryFeedback(.selection, trigger: highlighted) { _, action in action != nil }
            .sensoryFeedback(.impact(weight: .light), trigger: isLiked)
            .accessibilityElement()
            .accessibilityLabel("Like")
            .accessibilityAddTraits(.isButton)
            .accessibilityAddTraits(isLiked ? .isSelected : [])
            .accessibilityHint("Touch and hold, then slide up for more actions.")
            .accessibilityAction { isLiked.toggle() }
            .accessibilityActions {
                ForEach(ReelAction.allCases) { action in
                    Button(action.title) { onAction(action) }
                }
            }
    }

    private var heart: some View {
        Image(systemName: isLiked ? "heart.fill" : "heart")
            .font(.system(size: 30, weight: .regular))
            .foregroundStyle(MonoTheme.primary)
            .scaleEffect(isPressing && !isOpen ? 0.88 : 1)
            .frame(width: Self.heartSize, height: Self.heartSize)
            .background {
                if isOpen {
                    Circle().fill(MonoTheme.scrim.opacity(0.55))
                }
            }
    }

    /// The actions stacked above the heart, nearest first, each with its
    /// label to the left so the fan reads without guessing at icons.
    private var menu: some View {
        VStack(alignment: .trailing, spacing: Self.spacing - Self.itemSize) {
            ForEach(ReelAction.allCases.reversed()) { action in
                item(action)
            }
        }
        // Puts the nearest item's center one `spacing` above the heart's.
        .padding(.bottom, Self.heartSize / 2 + Self.spacing - Self.itemSize / 2)
        .padding(.trailing, (Self.heartSize - Self.itemSize) / 2)
        .fixedSize()
        .allowsHitTesting(false)
    }

    private func item(_ action: ReelAction) -> some View {
        let isOn = highlighted == action
        return HStack(spacing: 10) {
            Text(action.title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(isOn ? MonoTheme.onAccent : MonoTheme.primary)
                .padding(.horizontal, 12)
                .frame(height: 30)
                .background(Capsule().fill(isOn ? MonoTheme.accent : MonoTheme.scrim.opacity(0.55)))
            Image(systemName: action.systemImage)
                .font(.system(size: 21, weight: .medium))
                .foregroundStyle(isOn ? MonoTheme.onAccent : MonoTheme.primary)
                .frame(width: Self.itemSize, height: Self.itemSize)
                .background(Circle().fill(isOn ? MonoTheme.accent : MonoTheme.scrim.opacity(0.55)))
                .overlay(Circle().stroke(MonoTheme.primary.opacity(isOn ? 0 : 0.25)))
                .scaleEffect(isOn ? 1.12 : 1)
        }
        .transition(.scale(scale: 0.4, anchor: .bottomTrailing).combined(with: .opacity))
    }

    private var press: some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { value in
                if !isPressing {
                    isPressing = true
                    holdTask = Task {
                        try? await Task.sleep(for: Self.holdDuration)
                        if !Task.isCancelled, isPressing {
                            isOpen = true
                        }
                    }
                }
                if !isOpen, value.translation.height < -Self.slideToOpen {
                    isOpen = true
                }
                highlighted = isOpen ? Self.action(at: value.translation) : nil
            }
            .onEnded { value in
                holdTask?.cancel()
                let wasOpen = isOpen
                let chosen = highlighted
                isPressing = false
                isOpen = false
                highlighted = nil

                if wasOpen {
                    if let chosen { onAction(chosen) }
                } else if hypot(value.translation.width, value.translation.height) < Self.tapSlop {
                    isLiked.toggle()
                }
            }
    }

    /// The item under a finger that has moved `translation` from where it
    /// first touched the heart, or `nil` between, beside, or past the items.
    static func action(at translation: CGSize) -> ReelAction? {
        // The labels extend left, so allow a wider reach that way.
        guard translation.width > -140, translation.width < itemSize else { return nil }
        let step = Int((-translation.height / spacing).rounded()) - 1
        let actions = ReelAction.allCases
        return actions.indices.contains(step) ? actions[step] : nil
    }
}
