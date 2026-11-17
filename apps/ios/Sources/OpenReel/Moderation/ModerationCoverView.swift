import OpenReelATProto
import SwiftUI

/// Covers a blurred reel: what it was labeled, by whom, and a button to watch
/// anyway. Swallows taps so the reel underneath doesn't pause or play.
struct ModerationCoverView: View {
    let causes: [ModerationCause]
    let sourceName: (ModerationCause) -> String
    let onReveal: () -> Void

    var body: some View {
        ZStack {
            MonoTheme.scrim.opacity(0.55)
            VStack(spacing: 14) {
                Image(systemName: causes.first?.category?.systemImage ?? "eye.slash")
                    .font(.system(size: 44, weight: .light))
                Text(title)
                    .font(.title3.weight(.bold))
                Text("Labeled by \(sources)")
                    .font(.subheadline)
                    .foregroundStyle(MonoTheme.overlayText)
                Button(action: onReveal) {
                    Text("Show video")
                        .font(.subheadline.weight(.semibold))
                        .padding(.horizontal, 20)
                        .frame(height: 40)
                        .background(MonoTheme.chipFill, in: Capsule())
                        .overlay(Capsule().stroke(MonoTheme.primary.opacity(0.5)))
                }
                .buttonStyle(.plain)
                .padding(.top, 6)
            }
            .foregroundStyle(MonoTheme.primary)
            .multilineTextAlignment(.center)
            .padding(32)
        }
        .contentShape(Rectangle())
        .onTapGesture {}
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(title). Labeled by \(sources).")
        .accessibilityAction(named: Text("Show video"), onReveal)
    }

    private var title: String {
        var seen: Set<String> = []
        return causes.map(\.title).filter { seen.insert($0).inserted }.joined(separator: " · ")
    }

    private var sources: String {
        var seen: Set<String> = []
        return causes.map(sourceName).filter { seen.insert($0).inserted }.formatted(.list(type: .and))
    }
}

#Preview {
    ZStack {
        LinearGradient(colors: [.purple, .orange], startPoint: .top, endPoint: .bottom)
            .blur(radius: 50)
        ModerationCoverView(
            causes: [ModerationCause(value: "nsfw", source: "did:plc:author", isSelfLabel: true)],
            sourceName: { $0.isSelfLabel ? "the creator" : $0.source },
            onReveal: {}
        )
    }
    .ignoresSafeArea()
    .preferredColorScheme(.dark)
}
