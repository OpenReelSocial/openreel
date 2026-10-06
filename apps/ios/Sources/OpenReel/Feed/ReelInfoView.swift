import SwiftUI

/// Author, caption, and moderation labels in the bottom-left of a reel.
struct ReelInfoView: View {
    let reel: Reel

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                Text(reel.authorHandle)
                    .font(.headline)
                Button("Follow") {}
                    .font(.subheadline.weight(.semibold))
                    .padding(.horizontal, 12)
                    .frame(height: 28)
                    .overlay(Capsule().stroke(MonoTheme.primary.opacity(0.6)))
            }

            if !reel.caption.isEmpty {
                Text(reel.caption)
                    .font(.subheadline)
                    .foregroundStyle(MonoTheme.overlayText)
                    .lineLimit(3)
            }

            if !reel.tags.isEmpty {
                Text(reel.tags.map { "#\($0)" }.joined(separator: " "))
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
            }

            ForEach(reel.labels, id: \.self) { label in
                HStack(spacing: 6) {
                    Image(systemName: "shield")
                    Text("\(label.name) · \(label.labeler)")
                }
                .font(.caption)
                .foregroundStyle(MonoTheme.overlayText)
                .padding(.horizontal, 10)
                .frame(height: 26)
                .background(MonoTheme.chipFill, in: Capsule())
                .accessibilityElement(children: .combine)
                .accessibilityLabel("Labeled \(label.name) by \(label.labeler)")
            }
        }
        .foregroundStyle(MonoTheme.primary)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
