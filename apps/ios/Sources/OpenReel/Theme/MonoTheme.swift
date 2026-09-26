import SwiftUI

/// OpenReel's only color scheme: pure black chrome and white controls so the
/// video carries all the color. Dark-only by design; there is no light variant.
enum MonoTheme {
    static let background = Color.black
    static let primary = Color.white
    /// Unselected tab bar items and other low-emphasis chrome on black.
    static let secondary = Color(white: 0.54)
    /// Unselected feed tabs, drawn over video.
    static let inactiveOverlay = Color.white.opacity(0.7)
    /// Caption and other body text drawn over video.
    static let overlayText = Color.white.opacity(0.92)
    static let accent = Color.white
    static let onAccent = Color.black
    static let chipFill = Color.white.opacity(0.12)
    static let progressTrack = Color.white.opacity(0.2)
    /// Gradient base behind overlay text so it stays legible on bright video.
    static let scrim = Color.black
}
