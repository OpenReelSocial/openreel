import OpenReelATProto
import PhotosUI
import SwiftUI

/// The Create tab: pick a video from Photos, add a caption and tags, post,
/// then follow it through upload and processing until it plays in Latest.
@MainActor
struct CreateView: View {
    let store: PostStore
    let auth: AuthController
    /// Shows the new post in the feed.
    let onShowPost: (String) -> Void

    @State private var pickerItem: PhotosPickerItem?
    @FocusState private var focusedField: Field?

    private enum Field {
        case caption, tags
    }

    var body: some View {
        @Bindable var store = store
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("New post")
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(MonoTheme.primary)

                switch store.phase {
                case let .processing(uri), let .slowProcessing(uri), let .posted(uri):
                    progressCard(uri: uri)
                default:
                    form(caption: $store.caption, tags: $store.tagsText)
                }

                if let message = store.errorMessage {
                    errorBanner(message)
                }
            }
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(MonoTheme.background)
        .onChange(of: pickerItem) { _, item in
            guard let item else { return }
            store.load(item)
            // Picking the same video again must still fire onChange.
            pickerItem = nil
        }
    }

    // MARK: - Form

    @ViewBuilder
    private func form(caption: Binding<String>, tags: Binding<String>) -> some View {
        if let video = store.video {
            preview(video)
        } else if store.phase == .loading {
            placeholder {
                ProgressView("Loading video…")
                    .tint(MonoTheme.primary)
                    .foregroundStyle(MonoTheme.secondary)
            }
        } else {
            picker {
                placeholder {
                    VStack(spacing: 10) {
                        Image(systemName: "video.badge.plus")
                            .font(.system(size: 40, weight: .light))
                        Text("Choose a video")
                            .font(.headline)
                        Text("From your library, up to \(VideoPostLimits.maxVideoBytes / 1_000_000) MB")
                            .font(.subheadline)
                            .foregroundStyle(MonoTheme.secondary)
                    }
                    .foregroundStyle(MonoTheme.primary)
                }
            }
        }

        VStack(alignment: .leading, spacing: 6) {
            TextField("Write a caption…", text: caption, axis: .vertical)
                .lineLimit(3...6)
                .focused($focusedField, equals: .caption)
                .padding(12)
                .background(MonoTheme.chipFill, in: RoundedRectangle(cornerRadius: 10))
            Text("\(store.caption.count)/\(VideoPostLimits.maxCaptionGraphemes)")
                .font(.caption)
                .foregroundStyle(store.caption.count > VideoPostLimits.maxCaptionGraphemes ? .orange : MonoTheme.secondary)
                .frame(maxWidth: .infinity, alignment: .trailing)
        }

        TextField("#tags", text: tags)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .focused($focusedField, equals: .tags)
            .padding(12)
            .background(MonoTheme.chipFill, in: RoundedRectangle(cornerRadius: 10))

        if case let .uploading(fraction) = store.phase {
            VStack(alignment: .leading, spacing: 8) {
                ProgressView(value: fraction)
                    .tint(MonoTheme.primary)
                Text("Uploading… \(Int((fraction * 100).rounded()))%")
                    .font(.subheadline)
                    .foregroundStyle(MonoTheme.secondary)
            }
        } else {
            Button {
                focusedField = nil
                store.post()
            } label: {
                Text("Post")
                    .font(.headline)
                    .frame(maxWidth: .infinity, minHeight: 48)
            }
            .buttonStyle(.borderedProminent)
            .tint(MonoTheme.accent)
            .foregroundStyle(MonoTheme.onAccent)
            .disabled(!store.canPost)
        }
    }

    private func preview(_ video: PickedVideo) -> some View {
        HStack(alignment: .top, spacing: 16) {
            Group {
                if let image = video.preview {
                    Image(decorative: image, scale: 1)
                        .resizable()
                        .scaledToFill()
                } else {
                    Image(systemName: "film")
                        .font(.largeTitle)
                        .foregroundStyle(MonoTheme.secondary)
                }
            }
            .frame(width: 120, height: 180)
            .background(MonoTheme.chipFill)
            .clipShape(RoundedRectangle(cornerRadius: 10))

            VStack(alignment: .leading, spacing: 6) {
                Text(Self.duration(video.durationMs))
                    .font(.headline)
                    .foregroundStyle(MonoTheme.primary)
                Text(video.byteCount.formatted(.byteCount(style: .file)))
                    .font(.subheadline)
                    .foregroundStyle(MonoTheme.secondary)
                Spacer(minLength: 0)
                if !store.isBusy {
                    picker {
                        Label("Choose another", systemImage: "arrow.triangle.2.circlepath")
                            .font(.subheadline.weight(.medium))
                    }
                }
            }
            .frame(height: 180)
        }
    }

    private func picker<Label: View>(@ViewBuilder label: () -> Label) -> some View {
        // `.current` hands over the original file; transcoding to a more
        // compatible format would only slow the upload, and the media
        // pipeline transcodes anyway.
        PhotosPicker(selection: $pickerItem, matching: .videos, preferredItemEncoding: .current, label: label)
            .buttonStyle(.plain)
            .foregroundStyle(MonoTheme.primary)
    }

    private func placeholder<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        content()
            .frame(maxWidth: .infinity, minHeight: 220)
            .background(MonoTheme.chipFill, in: RoundedRectangle(cornerRadius: 14))
            .contentShape(Rectangle())
    }

    // MARK: - After posting

    @ViewBuilder
    private func progressCard(uri: String) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            switch store.phase {
            case .posted:
                Label("Your video is live", systemImage: "checkmark.circle.fill")
                    .font(.headline)
                Button {
                    onShowPost(uri)
                } label: {
                    Text("Watch in Latest")
                        .font(.headline)
                        .frame(maxWidth: .infinity, minHeight: 48)
                }
                .buttonStyle(.borderedProminent)
                .tint(MonoTheme.accent)
                .foregroundStyle(MonoTheme.onAccent)
            case .slowProcessing:
                Label("Still processing", systemImage: "hourglass")
                    .font(.headline)
                Text("This is taking longer than usual. Your video is posted and will appear in Latest once it's ready.")
                    .foregroundStyle(MonoTheme.secondary)
            default:
                HStack(spacing: 10) {
                    ProgressView()
                        .tint(MonoTheme.primary)
                    Text("Processing…")
                        .font(.headline)
                }
                Text("Your video is posted. Preparing it for playback usually takes under a minute; you can keep browsing.")
                    .foregroundStyle(MonoTheme.secondary)
            }
            Button("Post another video") { store.reset() }
                .font(.subheadline.weight(.medium))
                .padding(.top, 4)
        }
        .foregroundStyle(MonoTheme.primary)
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(MonoTheme.chipFill, in: RoundedRectangle(cornerRadius: 14))
    }

    private func errorBanner(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(message, systemImage: "exclamationmark.triangle.fill")
                .foregroundStyle(.orange)
            if store.needsSignIn {
                Button("Sign in again") {
                    Task { await auth.signOut() }
                }
                .buttonStyle(.bordered)
                .tint(MonoTheme.primary)
            }
        }
        .font(.subheadline)
    }

    private static func duration(_ milliseconds: Int) -> String {
        Duration.milliseconds(milliseconds).formatted(.time(pattern: .minuteSecond))
    }
}
