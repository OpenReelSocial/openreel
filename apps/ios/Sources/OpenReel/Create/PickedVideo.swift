import AVFoundation
import CoreTransferable
import OpenReelATProto
import UniformTypeIdentifiers

/// A video chosen in the Photos picker, copied into the app's temporary
/// directory, with what the `social.openreel.video.post` record needs to
/// know about it read by AVFoundation.
struct PickedVideo: Equatable {
    enum LoadError: Error {
        /// The file has no video track AVFoundation can read.
        case notAVideo
    }

    let fileURL: URL
    let mimeType: String
    let byteCount: Int
    let durationMs: Int
    let aspectRatio: VideoAspectRatio?
    /// First frame, upright, for the confirmation preview.
    let preview: CGImage?

    /// Reads size, type, duration, and display aspect ratio. Validates
    /// against the Lexicon's size and type limits before anything else, so an
    /// oversized file is rejected without decoding it.
    static func load(from fileURL: URL) async throws -> PickedVideo {
        let mimeType = UTType(filenameExtension: fileURL.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        let attributes = try FileManager.default.attributesOfItem(atPath: fileURL.path)
        let byteCount = (attributes[.size] as? NSNumber)?.intValue ?? 0
        try VideoPostLimits.validateVideo(size: byteCount, mimeType: mimeType)

        let asset = AVURLAsset(url: fileURL)
        let duration = try await asset.load(.duration)
        guard let track = try await asset.loadTracks(withMediaType: .video).first else {
            throw LoadError.notAVideo
        }
        let (size, transform) = try await track.load(.naturalSize, .preferredTransform)
        // A portrait phone video is stored landscape with a 90° transform.
        let display = size.applying(transform)

        let generator = AVAssetImageGenerator(asset: asset)
        generator.appliesPreferredTrackTransform = true
        generator.maximumSize = CGSize(width: 720, height: 720)
        let preview = try? await generator.image(at: .zero).image

        return PickedVideo(
            fileURL: fileURL,
            mimeType: mimeType,
            byteCount: byteCount,
            durationMs: max(1, Int((duration.seconds * 1000).rounded())),
            aspectRatio: VideoAspectRatio(displayWidth: display.width, displayHeight: display.height),
            preview: preview
        )
    }

    /// Removes the temporary copy.
    func discard() {
        try? FileManager.default.removeItem(at: fileURL)
    }
}

/// The Photos picker's movie as a file of our own. Photos hands over a file
/// it deletes after the import closure returns, so it is copied out.
struct PickedMovieFile: Transferable {
    let url: URL

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(contentType: .movie) { movie in
            SentTransferredFile(movie.url)
        } importing: { received in
            let directory = FileManager.default.temporaryDirectory.appending(path: "uploads", directoryHint: .isDirectory)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let copy = directory.appending(path: "\(UUID().uuidString).\(received.file.pathExtension)")
            try FileManager.default.copyItem(at: received.file, to: copy)
            return PickedMovieFile(url: copy)
        }
    }
}
