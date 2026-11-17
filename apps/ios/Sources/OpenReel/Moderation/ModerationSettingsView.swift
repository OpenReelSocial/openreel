import OpenReelATProto
import SwiftUI

/// Content filters for each label category, and the moderation services the
/// app listens to. Opened from Account.
struct ModerationSettingsView: View {
    let moderation: ModerationController

    var body: some View {
        List {
            Section {
                ForEach(ContentCategory.allCases) { category in
                    Picker(selection: binding(for: category)) {
                        ForEach(ContentVisibility.allCases) { visibility in
                            Text(visibility.title(for: category)).tag(visibility)
                        }
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(category.title)
                            Text(category.summary)
                                .font(.caption)
                                .foregroundStyle(MonoTheme.secondary)
                        }
                    }
                }
            } header: {
                Text("Content filters")
            } footer: {
                Text("Applies to labels from creators and from the moderation services below. Blur shows a cover you can tap through; Hide leaves the video out of your feeds. Saved on this device.")
            }

            Section {
                LabeledContent("OpenReel Moderation") {
                    Text(moderation.baselineLabelerDID == nil ? "Not set up yet" : "Always on")
                }
                if let did = moderation.baselineLabelerDID {
                    LabeledContent("DID", value: did)
                        .textSelection(.enabled)
                }
            } header: {
                Text("Moderation services")
            } footer: {
                Text("OpenReel's baseline service labels content for everyone and can't be turned off. Removed content still exists on the creator's server; it just isn't shown here.")
            }
        }
        .navigationTitle("Moderation")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func binding(for category: ContentCategory) -> Binding<ContentVisibility> {
        Binding(
            get: { moderation.visibility(for: category) },
            set: { moderation.setVisibility($0, for: category) }
        )
    }
}

#Preview {
    NavigationStack {
        ModerationSettingsView(moderation: ModerationController())
    }
    .preferredColorScheme(.dark)
}
