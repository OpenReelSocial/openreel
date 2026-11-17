import AVKit
import OpenReelATProto
import PhotosUI
import SwiftUI

/// The Create tab: pick a video from Photos, watch it play while you write a
/// caption and tags, post, then follow it through upload and processing until
/// it plays in Latest. The picked clip leads the screen — a tappable preview
/// above the caption and tags, with Post pinned to the bottom.
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
        Group {
            switch store.phase {
            case let .processing(uri), let .slowProcessing(uri), let .posted(uri):
                ScrollView {
                    progressCard(uri: uri)
                        .padding(20)
                }
            default:
                composer(caption: $store.caption, tags: $store.tagsText)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(MonoTheme.background)
        .onChange(of: pickerItem) { _, item in
            guard let item else { return }
            store.load(item)
            // Picking the same video again must still fire onChange.
            pickerItem = nil
        }
    }

    // MARK: - Composer

    @ViewBuilder
    private func composer(caption: Binding<String>, tags: Binding<String>) -> some View {
        if let video = store.video {
            VStack(spacing: 0) {
                VideoPreviewPlayer(url: video.fileURL, aspectRatio: video.aspectRatio)
                    .frame(maxWidth: .infinity)
                    .frame(maxHeight: 380)
                    .background(Color.black)
                    .overlay(alignment: .topLeading) {
                        if !store.isBusy {
                            Button {
                                focusedField = nil
                                store.reset()
                            } label: {
                                Image(systemName: "xmark")
                                    .font(.subheadline.weight(.bold))
                                    .foregroundStyle(.white)
                                    .frame(width: 32, height: 32)
                                    .background(.black.opacity(0.5), in: Circle())
                            }
                            .padding(12)
                            .accessibilityLabel("Discard this post")
                        }
                    }

                details(video: video, caption: caption, tags: tags)
            }
            .safeAreaInset(edge: .bottom) { actionBar }
        } else if store.phase == .loading {
            fullBleed {
                ProgressView("Loading video…")
                    .tint(MonoTheme.primary)
                    .foregroundStyle(MonoTheme.secondary)
            }
        } else {
            picker {
                fullBleed {
                    VStack(spacing: 10) {
                        Image(systemName: "video.badge.plus")
                            .font(.system(size: 44, weight: .light))
                        Text("Choose a video")
                            .font(.title3.weight(.semibold))
                        Text("From your library, up to \(VideoPostLimits.maxVideoBytes / 1_000_000) MB")
                            .font(.subheadline)
                            .foregroundStyle(MonoTheme.secondary)
                    }
                    .foregroundStyle(MonoTheme.primary)
                }
            }
        }
    }

    // MARK: - Details (under the preview)

    @ViewBuilder
    private func details(video: PickedVideo, caption: Binding<String>, tags: Binding<String>) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text(Self.summary(video))
                    .font(.caption)
                    .foregroundStyle(MonoTheme.secondary)

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

                if let message = store.errorMessage {
                    errorBanner(message)
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .scrollDismissesKeyboard(.interactively)
    }

    // MARK: - Action bar (pinned)

    @ViewBuilder
    private var actionBar: some View {
        Group {
            if case let .uploading(fraction) = store.phase {
                VStack(alignment: .leading, spacing: 8) {
                    ProgressView(value: fraction)
                        .tint(MonoTheme.primary)
                    Text("Uploading… \(Int((fraction * 100).rounded()))%")
                        .font(.subheadline)
                        .foregroundStyle(MonoTheme.secondary)
                }
            } else {
                HStack(spacing: 10) {
                    picker {
                        Image(systemName: "arrow.triangle.2.circlepath")
                            .font(.headline)
                            .frame(width: 54, height: 48)
                            .background(MonoTheme.chipFill, in: RoundedRectangle(cornerRadius: 12))
                    }
                    .accessibilityLabel("Choose another video")

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
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(MonoTheme.background)
        .overlay(alignment: .top) {
            Rectangle()
                .fill(MonoTheme.primary.opacity(0.1))
                .frame(height: 0.5)
        }
    }

    // MARK: - Pickers and placeholders

    private func picker<Label: View>(@ViewBuilder label: () -> Label) -> some View {
        // `.current` hands over the original file; transcoding to a more
        // compatible format would only slow the upload, and the media
        // pipeline transcodes anyway.
        PhotosPicker(selection: $pickerItem, matching: .videos, preferredItemEncoding: .current, label: label)
            .buttonStyle(.plain)
            .foregroundStyle(MonoTheme.primary)
    }

    private func fullBleed<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        content()
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding(24)
            .background(MonoTheme.background)
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

    /// "0:47 · 18.3 MB · 9:16" for the line under the preview.
    private static func summary(_ video: PickedVideo) -> String {
        var parts = [duration(video.durationMs), video.byteCount.formatted(.byteCount(style: .file))]
        if let ratio = video.aspectRatio {
            parts.append("\(ratio.width):\(ratio.height)")
        }
        return parts.joined(separator: " · ")
    }

    private static func duration(_ milliseconds: Int) -> String {
        Duration.milliseconds(milliseconds).formatted(.time(pattern: .minuteSecond))
    }
}

/// A tappable preview of the picked clip, sized to the video's aspect ratio so
/// a portrait reel shows upright. Rebuilds its player when a different clip is
/// chosen and pauses when it leaves the screen.
@MainActor
private struct VideoPreviewPlayer: View {
    let url: URL
    let aspectRatio: VideoAspectRatio?

    @State private var player: AVPlayer?

    private var ratio: CGFloat {
        guard let aspectRatio, aspectRatio.width > 0, aspectRatio.height > 0 else { return 9.0 / 16.0 }
        return CGFloat(aspectRatio.width) / CGFloat(aspectRatio.height)
    }

    var body: some View {
        VideoPlayer(player: player)
            .aspectRatio(ratio, contentMode: .fit)
            .onChange(of: url, initial: true) { _, newURL in
                player = AVPlayer(url: newURL)
            }
            .onDisappear { player?.pause() }
    }
}
