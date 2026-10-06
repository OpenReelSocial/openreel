import AVFoundation
import SwiftUI
import UIKit

/// Thin UIKit bridge so `AVPlayerLayer` can render full-bleed, controls-free
/// playback. AVKit's `VideoPlayer` always shows transport controls, which
/// doesn't fit a short-form vertical feed.
final class PlayerLayerContainerView: UIView {
    override static var layerClass: AnyClass { AVPlayerLayer.self }

    var playerLayer: AVPlayerLayer {
        // swiftlint:disable:next force_cast
        layer as! AVPlayerLayer
    }

    /// Called on the main queue when the layer starts or stops having a frame
    /// to show, so the cell can keep the poster up until then.
    var onReadyForDisplayChange: ((Bool) -> Void)?
    private var readyObservation: NSKeyValueObservation?

    override init(frame: CGRect) {
        super.init(frame: frame)
        readyObservation = playerLayer.observe(\.isReadyForDisplay, options: [.initial, .new]) { [weak self] layer, _ in
            let ready = layer.isReadyForDisplay
            // Deferred: SwiftUI state must not change during a view update.
            DispatchQueue.main.async { self?.onReadyForDisplayChange?(ready) }
        }
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not used")
    }
}

struct HLSPlayerView: UIViewRepresentable {
    let player: AVPlayer
    var videoGravity: AVLayerVideoGravity = .resizeAspectFill
    var onReadyForDisplayChange: ((Bool) -> Void)?

    func makeUIView(context: Context) -> PlayerLayerContainerView {
        let view = PlayerLayerContainerView()
        updateUIView(view, context: context)
        return view
    }

    func updateUIView(_ uiView: PlayerLayerContainerView, context: Context) {
        uiView.onReadyForDisplayChange = onReadyForDisplayChange
        if uiView.playerLayer.player !== player {
            uiView.playerLayer.player = player
        }
        uiView.playerLayer.videoGravity = videoGravity
    }

    static func dismantleUIView(_ uiView: PlayerLayerContainerView, coordinator: ()) {
        // The player is pooled and may already belong to another cell.
        uiView.onReadyForDisplayChange = nil
        uiView.playerLayer.player = nil
    }
}
