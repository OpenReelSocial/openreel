import Foundation
import Observation
import OpenReelATProto
import PhotosUI
import SwiftUI
import UIKit

/// Posting a video from the Create tab: loading the picked video, uploading
/// it with a `social.openreel.video.post` record, then waiting until the
/// AppView serves it (the media pipeline transcodes it to HLS first). Lives
/// as long as the tab view, so an upload continues while the user watches
/// the feed.
@MainActor
@Observable
final class PostStore {
    enum Phase: Equatable {
        case idle
        /// Copying the video out of Photos and reading its metadata.
        case loading
        /// A video is picked; the user is writing the caption.
        case ready
        /// Fraction of the video sent.
        case uploading(Double)
        /// The record is written; waiting for the post to show up in the feed.
        case processing(uri: String)
        /// The post plays in the feed, `seconds` after the user tapped Post.
        case posted(uri: String, seconds: Int)
        /// Not in the feed after `processingTimeout`; it may still appear.
        case slowProcessing(uri: String)
    }

    private(set) var phase: Phase = .idle
    private(set) var video: PickedVideo?
    /// Shown under the form; the picked video and caption are kept to retry.
    private(set) var errorMessage: String?
    /// The session expired; posting needs a new sign-in.
    private(set) var needsSignIn = false
    var caption = ""
    var tagsText = ""

    @ObservationIgnored private var loadTask: Task<Void, Never>?
    @ObservationIgnored private var postTask: Task<Void, Never>?

    private let auth: AuthController
    private let appView: AppViewClient

    /// Transcoding a short clip takes seconds; give up waiting after this.
    private static let processingTimeout: TimeInterval = 180
    private static let pollInterval: Duration = .seconds(2)

    init(auth: AuthController, appView: AppViewClient) {
        self.auth = auth
        self.appView = appView
    }

    var tags: [String] { VideoPostLimits.tags(from: tagsText) }

    var isBusy: Bool {
        switch phase {
        case .loading, .uploading: true
        default: false
        }
    }

    var canPost: Bool { video != nil && !isBusy }

    // MARK: - Picking

    func load(_ item: PhotosPickerItem) {
        loadTask?.cancel()
        postTask?.cancel()
        video?.discard()
        video = nil
        errorMessage = nil
        needsSignIn = false
        phase = .loading
        loadTask = Task {
            do {
                guard let file = try await item.loadTransferable(type: PickedMovieFile.self) else {
                    throw PickedVideo.LoadError.notAVideo
                }
                do {
                    let picked = try await PickedVideo.load(from: file.url)
                    guard !Task.isCancelled else { return picked.discard() }
                    video = picked
                    phase = .ready
                } catch {
                    try? FileManager.default.removeItem(at: file.url)
                    throw error
                }
            } catch {
                guard !Task.isCancelled else { return }
                phase = .idle
                errorMessage = Self.message(for: error)
            }
        }
    }

    /// Back to an empty form, e.g. to post another video.
    func reset() {
        loadTask?.cancel()
        postTask?.cancel()
        video?.discard()
        video = nil
        caption = ""
        tagsText = ""
        errorMessage = nil
        needsSignIn = false
        phase = .idle
    }

    // MARK: - Posting

    func post() {
        guard let video, canPost else { return }
        let caption = caption
        let tags = tags
        do {
            try VideoPostLimits.validateDetails(durationMs: video.durationMs, caption: caption, tags: tags)
        } catch {
            errorMessage = Self.message(for: error)
            return
        }
        errorMessage = nil
        needsSignIn = false
        phase = .uploading(0)
        let manager = auth.manager
        let started = Date()

        postTask = Task {
            // Lets the upload finish if the user leaves the app mid-way.
            let background = UIApplication.shared.beginBackgroundTask(withName: "Upload video")
            defer { UIApplication.shared.endBackgroundTask(background) }

            let output: CreateRecordOutput
            do {
                let data = try Data(contentsOf: video.fileURL, options: .alwaysMapped)
                output = try await manager.postVideo(
                    data,
                    mimeType: video.mimeType,
                    durationMs: video.durationMs,
                    aspectRatio: video.aspectRatio,
                    caption: caption,
                    tags: tags,
                    uploadProgress: { [weak self] fraction in
                        Task { @MainActor in self?.uploadProgressed(fraction) }
                    }
                )
            } catch {
                guard !Task.isCancelled else { return }
                phase = .ready
                if case ATProtoError.sessionExpired = error { needsSignIn = true }
                if case ATProtoError.notSignedIn = error { needsSignIn = true }
                errorMessage = Self.message(for: error)
                print("[post] could not post: \(error)")
                return
            }

            print("[post] created \(output.uri) after \(Int(Date().timeIntervalSince(started)))s")
            video.discard()
            self.video = nil
            self.caption = ""
            self.tagsText = ""
            phase = .processing(uri: output.uri)
            await waitUntilPlayable(output.uri, since: started)
        }
    }

    private func uploadProgressed(_ fraction: Double) {
        guard case .uploading = phase else { return }
        phase = .uploading(fraction)
    }

    /// Polls the default (newest-first) feed until the AppView hydrates the
    /// post, which it does only once its HLS renditions exist.
    private func waitUntilPlayable(_ uri: String, since started: Date) async {
        while Date().timeIntervalSince(started) < Self.processingTimeout {
            try? await Task.sleep(for: Self.pollInterval)
            guard !Task.isCancelled, phase == .processing(uri: uri) else { return }
            // A failed poll (offline for a moment) just waits for the next.
            if let page = try? await appView.getFeed(limit: 30), page.feed.contains(where: { $0.uri == uri }) {
                guard phase == .processing(uri: uri) else { return }
                let seconds = Int(Date().timeIntervalSince(started).rounded())
                print("[post] \(uri) playable \(seconds)s after posting")
                phase = .posted(uri: uri, seconds: seconds)
                return
            }
        }
        if phase == .processing(uri: uri) { phase = .slowProcessing(uri: uri) }
    }

    // MARK: - Errors

    static func message(for error: Error) -> String {
        switch error {
        case let error as VideoPostError:
            return message(for: error)
        case PickedVideo.LoadError.notAVideo:
            return "That file isn't a video OpenReel can read."
        case ATProtoError.sessionExpired, ATProtoError.notSignedIn:
            return "Your session has expired. Sign in again to post."
        case let ATProtoError.xrpc(status, code, detail):
            // nginx answers an oversized body with 413 before the PDS sees it.
            if status == 413 || code == "BlobTooLarge" || code == "PayloadTooLarge" {
                return message(for: VideoPostError.tooLarge(bytes: 0, limit: VideoPostLimits.maxVideoBytes))
            }
            return "The server rejected the post: \(detail ?? code ?? "HTTP \(status)")."
        default:
            return UserFacingError.message(for: error)
        }
    }

    private static func message(for error: VideoPostError) -> String {
        let megabytes = VideoPostLimits.maxVideoBytes / 1_000_000
        switch error {
        case .empty:
            return "That video is empty."
        case .tooLarge:
            return "That video is too large. Videos can be up to \(megabytes) MB."
        case .unsupportedType:
            return "That file isn't a video OpenReel can post."
        case .invalidDuration:
            return "Could not read how long that video is."
        case let .captionTooLong(limit):
            return "Captions can be up to \(limit) characters."
        case let .tooManyTags(limit):
            return "Use up to \(limit) tags."
        case let .tagTooLong(tag, limit):
            return "#\(tag.prefix(20))… is too long; tags can be up to \(limit) characters."
        }
    }
}
