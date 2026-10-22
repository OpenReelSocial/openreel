import OpenReelATProto
import SwiftUI

/// Every feed the AppView offers, each with the ranking method and weights its
/// generator discloses (project plan 3.2.1, "Algorithm Selection"). Picking
/// one switches the feed in place.
struct FeedPickerView: View {
    let feeds: [FeedGeneratorView]
    let selection: String?
    var onSelect: (FeedGeneratorView) -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(feeds) { feed in
                        Button {
                            onSelect(feed)
                            dismiss()
                        } label: {
                            FeedDescriptionRow(feed: feed, isSelected: feed.uri == selection)
                        }
                        .buttonStyle(.plain)
                    }
                } footer: {
                    Text("Each feed comes from a feed generator that publishes how it ranks. Weights show how much each signal counts toward a video's score.")
                }
            }
            .navigationTitle("Feeds")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}

private struct FeedDescriptionRow: View {
    let feed: FeedGeneratorView
    let isSelected: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                Text(feed.displayName)
                    .font(.headline)
                if let description = feed.description {
                    Text(description)
                        .font(.subheadline)
                        .foregroundStyle(MonoTheme.secondary)
                }
                Label(Self.criteriaName(feed.rankingCriteria), systemImage: "slider.horizontal.3")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(MonoTheme.secondary)
                ForEach(feed.weights, id: \.signal) { weight in
                    Text(Self.describe(weight))
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(MonoTheme.secondary)
                }
            }
            Spacer(minLength: 0)
            if isSelected {
                Image(systemName: "checkmark")
                    .font(.body.weight(.semibold))
                    .accessibilityLabel("Selected")
            }
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
    }

    /// Plain-language names for the generator record's ranking families.
    static func criteriaName(_ criteria: String) -> String {
        switch criteria {
        case "chronological": return "Chronological: no ranking"
        case "heuristic": return "Weighted by public signals"
        case "social": return "Based on who you follow"
        case "personalized": return "Personalized from your activity"
        case "collaborative": return "Based on similar viewers"
        case "hybrid": return "Mix of methods"
        default: return criteria
        }
    }

    static func describe(_ weight: RankingWeight) -> String {
        let percent = "\(Int((weight.fraction * 100).rounded()))%"
        switch weight.signal {
        case "views":
            return "\(percent) · Views"
        case "recency":
            let halfLife = weight.halfLifeHours.map { ", halves every \($0) h" } ?? ""
            return "\(percent) · Recency\(halfLife)"
        default:
            return "\(percent) · \(weight.signal.capitalized)"
        }
    }
}

#Preview {
    FeedPickerView(feeds: MockReelProvider.feeds, selection: MockReelProvider.feeds.first?.uri) { _ in }
        .preferredColorScheme(.dark)
}
