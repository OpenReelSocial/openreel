import OpenReelATProto
import SwiftUI

/// The signed-in user's profile: avatar, name, counts, actions, and a grid of
/// their videos.
///
/// There is no profile record or social graph yet, so the name comes from the
/// handle, follow counts are zero, and the videos are the user's posts among
/// those the feed has loaded. Account details and sign-out open as a sheet.
struct ProfileView: View {
    let auth: AuthController
    let session: OAuthSession
    /// Set when the server could not be reached on launch.
    let unavailability: ServerUnavailability?
    let reels: [Reel]

    @State private var section: ContentTab = .videos
    @State private var isShowingAccount = false

    enum ContentTab: CaseIterable, Identifiable {
        case videos
        case liked

        var id: Self { self }

        var title: String {
            switch self {
            case .videos: "Videos"
            case .liked: "Liked"
            }
        }

        var systemImage: String {
            switch self {
            case .videos: "square.grid.3x3"
            case .liked: "heart"
            }
        }
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                if let unavailability {
                    unavailableBanner(unavailability)
                }
                header
                    .padding(.top, 24)
                    .padding(.horizontal, 20)
                sectionPicker
                    .padding(.top, 28)
                content
            }
        }
        .scrollIndicators(.hidden)
        .background(MonoTheme.background)
        .safeAreaInset(edge: .top, spacing: 0) { topBar }
        .sheet(isPresented: $isShowingAccount) {
            AccountView(auth: auth, session: session, unavailability: unavailability)
                .preferredColorScheme(.dark)
        }
    }

    // MARK: - Header

    private var topBar: some View {
        ZStack {
            Text(handle)
                .font(.headline)
                .lineLimit(1)
                .padding(.horizontal, 56)
            HStack {
                Spacer()
                Button {
                    isShowingAccount = true
                } label: {
                    Image(systemName: "gearshape")
                        .font(.system(size: 20, weight: .regular))
                        .frame(width: 44, height: 44)
                }
                .accessibilityLabel("Account settings")
            }
            .padding(.horizontal, 8)
        }
        .foregroundStyle(MonoTheme.primary)
        .frame(height: 44)
        .background(MonoTheme.background)
    }

    private var header: some View {
        VStack(spacing: 14) {
            avatar
            VStack(spacing: 4) {
                Text(displayName)
                    .font(.title2.weight(.bold))
                Text(handle)
                    .font(.subheadline)
                    .foregroundStyle(MonoTheme.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            .foregroundStyle(MonoTheme.primary)

            stats
                .padding(.top, 6)

            HStack(spacing: 10) {
                Button {
                    isShowingAccount = true
                } label: {
                    actionLabel("Account")
                }
                ShareLink(item: "Find me on OpenReel: \(handle)") {
                    actionLabel("Share profile")
                }
            }
            .buttonStyle(.plain)
            .padding(.top, 4)

            Label("Identity hosted on \(session.pdsURL.host() ?? session.pdsURL.absoluteString)", systemImage: "globe")
                .font(.caption)
                .foregroundStyle(MonoTheme.secondary)
                .lineLimit(1)
        }
    }

    private var avatar: some View {
        Circle()
            .fill(Color(white: 0.16))
            .overlay(
                Text(initial)
                    .font(.system(size: 40, weight: .semibold, design: .rounded))
                    .foregroundStyle(MonoTheme.primary)
            )
            .overlay(Circle().stroke(MonoTheme.primary.opacity(0.9), lineWidth: 2))
            .frame(width: 96, height: 96)
            .accessibilityHidden(true)
    }

    private var stats: some View {
        HStack(spacing: 0) {
            stat(reels.count, "Videos")
            divider
            stat(0, "Following")
            divider
            stat(0, "Followers")
        }
        .fixedSize()
    }

    private func stat(_ value: Int, _ label: String) -> some View {
        VStack(spacing: 2) {
            Text(value, format: .number)
                .font(.headline.monospacedDigit())
                .foregroundStyle(MonoTheme.primary)
            Text(label)
                .font(.caption)
                .foregroundStyle(MonoTheme.secondary)
        }
        .frame(minWidth: 84)
        .accessibilityElement(children: .combine)
    }

    private var divider: some View {
        Rectangle()
            .fill(MonoTheme.secondary.opacity(0.4))
            .frame(width: 1, height: 22)
    }

    private func actionLabel(_ title: String) -> some View {
        Text(title)
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(MonoTheme.primary)
            .frame(width: 140, height: 38)
            .background(MonoTheme.chipFill, in: RoundedRectangle(cornerRadius: 10))
    }

    private func unavailableBanner(_ unavailability: ServerUnavailability) -> some View {
        HStack(spacing: 10) {
            Image(systemName: "wifi.exclamationmark")
            Text(UserFacingError.message(for: unavailability))
                .font(.footnote)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button("Retry") {
                Task { await auth.restore() }
            }
            .font(.footnote.weight(.semibold))
        }
        .foregroundStyle(.orange)
        .padding(12)
        .background(Color.orange.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
        .padding(.horizontal, 16)
        .padding(.top, 8)
    }

    // MARK: - Videos

    private var sectionPicker: some View {
        HStack(spacing: 0) {
            ForEach(ContentTab.allCases) { item in
                let isSelected = item == section
                Button {
                    withAnimation(.snappy) { section = item }
                } label: {
                    Image(systemName: item.systemImage)
                        .symbolVariant(isSelected ? .fill : .none)
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(isSelected ? MonoTheme.primary : MonoTheme.secondary)
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .overlay(alignment: .bottom) {
                            Rectangle()
                                .fill(isSelected ? MonoTheme.accent : .clear)
                                .frame(height: 2)
                        }
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(item.title)
                .accessibilityAddTraits(isSelected ? .isSelected : [])
            }
        }
        .overlay(alignment: .bottom) {
            Rectangle().fill(MonoTheme.chipFill).frame(height: 1)
        }
    }

    @ViewBuilder
    private var content: some View {
        switch section {
        case .videos where reels.isEmpty:
            emptyState("No videos yet", detail: "Videos you post will show up here.", systemImage: "video")
        case .videos:
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 2), count: 3), spacing: 2) {
                ForEach(reels) { reel in
                    ProfileVideoCell(reel: reel)
                }
            }
            .padding(.top, 2)
        case .liked:
            emptyState("No liked videos yet", detail: "Videos you like will show up here.", systemImage: "heart")
        }
    }

    private func emptyState(_ title: String, detail: String, systemImage: String) -> some View {
        VStack(spacing: 10) {
            Image(systemName: systemImage)
                .font(.system(size: 34, weight: .light))
                .foregroundStyle(MonoTheme.secondary)
            Text(title)
                .font(.headline)
                .foregroundStyle(MonoTheme.primary)
            Text(detail)
                .font(.subheadline)
                .foregroundStyle(MonoTheme.secondary)
        }
        .multilineTextAlignment(.center)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 56)
        .accessibilityElement(children: .combine)
    }

    // MARK: - Identity

    /// `@gabe.openreel.example`, or the DID for an account without a handle.
    private var handle: String {
        session.handle.map { "@\($0.rawValue)" } ?? session.did.rawValue
    }

    /// The handle's first label, capitalized, until profiles have names.
    private var displayName: String {
        guard let handle = session.handle?.rawValue,
              let first = handle.split(separator: ".").first
        else { return "OpenReel user" }
        return first.prefix(1).uppercased() + first.dropFirst()
    }

    private var initial: String {
        String(displayName.prefix(1)).uppercased()
    }
}

/// One video in the profile grid: its poster in a 9:16 tile with its length.
private struct ProfileVideoCell: View {
    let reel: Reel

    var body: some View {
        Color(white: 0.12)
            .aspectRatio(9 / 16, contentMode: .fit)
            .overlay {
                AsyncImage(url: reel.posterURL) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    Image(systemName: "play.rectangle")
                        .font(.title3)
                        .foregroundStyle(MonoTheme.secondary)
                }
            }
            .overlay(alignment: .bottomLeading) {
                if let durationMs = reel.durationMs {
                    Label(ReelScrubber.timestamp(TimeInterval(durationMs) / 1000), systemImage: "play.fill")
                        .font(.caption2.weight(.semibold).monospacedDigit())
                        .foregroundStyle(MonoTheme.primary)
                        .shadow(color: MonoTheme.scrim.opacity(0.7), radius: 2)
                        .padding(6)
                }
            }
            .clipped()
            .accessibilityElement()
            .accessibilityLabel(reel.caption.isEmpty ? "Video" : reel.caption)
    }
}
