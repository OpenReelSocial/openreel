import Foundation

/// The OpenReel deployment this build talks to: the PDS and PLC directory it
/// signs in against (Debug only; see AppAuthConfiguration) and the AppView
/// its feed reads from.
enum Backend {
    /// The shared dev/demo server (ADR-0005): PDS at the root, PLC under
    /// `/plc`, AppView under `/appview`, media under `/media`.
    case devServer
    /// The AWS dev/demo host (ADR-0007), same layout as the dev server at
    /// dev.openreel.social. Media URLs come from the AppView's `getFeed`, so
    /// CloudFront needs no setting here.
    case aws
    /// The Compose stack from the repository root (`make up`). Simulator only:
    /// a device cannot reach the Mac's localhost.
    case localStack

    /// Debug builds use the dev server unless the scheme's Run environment
    /// sets `OPENREEL_BACKEND` to `aws` or `local`. The variable only applies
    /// to launches from Xcode; a device app opened from the home screen uses
    /// the default. Release builds always use the dev server.
    static let current: Backend = {
        #if DEBUG
        switch ProcessInfo.processInfo.environment["OPENREEL_BACKEND"] {
        case "local": return .localStack
        case "aws": return .aws
        default: break
        }
        #endif
        return .devServer
    }()

    var pdsURL: URL {
        switch self {
        case .devServer: return URL(string: "https://openreel.zackmurry.com")!
        case .aws: return URL(string: "https://dev.openreel.social")!
        // infra/pds/compose.yaml publishes the PDS on 3000.
        case .localStack: return URL(string: "http://localhost:3000")!
        }
    }

    var plcURL: URL {
        switch self {
        case .devServer: return URL(string: "https://openreel.zackmurry.com/plc")!
        case .aws: return URL(string: "https://dev.openreel.social/plc")!
        // The private PLC directory from infra/pds/compose.yaml.
        case .localStack: return URL(string: "http://localhost:2582")!
        }
    }

    var appViewURL: URL {
        switch self {
        case .devServer: return URL(string: "https://openreel.zackmurry.com/appview")!
        case .aws: return URL(string: "https://dev.openreel.social/appview")!
        // compose.yaml publishes the AppView on 3001 (and media on 3006).
        case .localStack: return URL(string: "http://localhost:3001")!
        }
    }

    var isLocal: Bool { self == .localStack }
}
