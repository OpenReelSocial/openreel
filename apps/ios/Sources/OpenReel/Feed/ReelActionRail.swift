import SwiftUI

/// Vertical stack of engagement controls on the right edge of a reel.
/// Actions other than the local like toggle are not wired up yet.
struct ReelActionRail: View {
    let authorHandle: String
    @Binding var isLiked: Bool

    var body: some View {
        VStack(spacing: 20) {
            avatar
            railButton(
                "Like",
                systemImage: isLiked ? "heart.fill" : "heart",
                action: { isLiked.toggle() }
            )
            .accessibilityAddTraits(isLiked ? .isSelected : [])
            railButton("Reply", systemImage: "bubble.right", action: {})
            railButton("Repost", systemImage: "arrow.2.squarepath", action: {})
            railButton("Share", systemImage: "square.and.arrow.up", action: {})
        }
        .foregroundStyle(MonoTheme.primary)
    }

    private var avatar: some View {
        ZStack(alignment: .bottom) {
            Circle()
                .fill(Color(white: 0.3))
                .overlay(
                    Image(systemName: "person.fill")
                        .font(.system(size: 20))
                        .foregroundStyle(MonoTheme.secondary)
                )
                .overlay(Circle().stroke(MonoTheme.primary, lineWidth: 2))
                .frame(width: 46, height: 46)
                .padding(.bottom, 10)

            Button {} label: {
                Image(systemName: "plus")
                    .font(.system(size: 11, weight: .heavy))
                    .foregroundStyle(MonoTheme.onAccent)
                    .frame(width: 22, height: 22)
                    .background(MonoTheme.accent, in: Circle())
            }
            .accessibilityLabel("Follow \(authorHandle)")
        }
    }

    private func railButton(
        _ title: String,
        systemImage: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 28, weight: .regular))
                .frame(width: 44, height: 44)
        }
        .accessibilityLabel(title)
    }
}
