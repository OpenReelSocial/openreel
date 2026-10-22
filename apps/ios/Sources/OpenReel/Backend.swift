import Foundation

/// The OpenReel deployment this build talks to: the PDS and PLC directory it
/// signs in against (Debug only; see AppAuthConfiguration) and the AppView
/// its feed reads from.
enum Backend {
    /// The shared dev/demo backend on AWS (ADR-0007) at dev.openreel.social:
    /// PDS at the root, PLC under `/plc`, AppView under `/appview`. Media
    /// URLs come from the AppView's `getFeed` (CloudFront), so they need no
    /// setting here.
    case aws
    /// The earlier dev server on Hetzner (ADR-0005, superseded by ADR-0007),
    /// same layout, with media under `/media`. Kept until it is shut down.
    case devServer
    /// The Compose stack from the repository root (`make up`). Simulator only:
    /// a device cannot reach the Mac's localhost.
    case localStack

    /// Debug builds use AWS unless the scheme's Run environment sets
    /// `OPENREEL_BACKEND` to `local` or `dev-server`. The variable only
    /// applies to launches from Xcode; a device app opened from the home
    /// screen uses the default. Release builds always use AWS, the shared
    /// deployment.
    static let current: Backend = {
        #if DEBUG
        switch ProcessInfo.processInfo.environment["OPENREEL_BACKEND"] {
        case "local": return .localStack
        case "dev-server": return .devServer
        default: break
        }
        #endif
        return .aws
    }()

    var pdsURL: URL {
        switch self {
        case .aws: return URL(string: "https://dev.openreel.social")!
        case .devServer: return URL(string: "https://openreel.zackmurry.com")!
        // infra/pds/compose.yaml publishes the PDS on 3000.
        case .localStack: return URL(string: "http://localhost:3000")!
        }
    }

    var plcURL: URL {
        switch self {
        case .aws: return URL(string: "https://dev.openreel.social/plc")!
        case .devServer: return URL(string: "https://openreel.zackmurry.com/plc")!
        // The private PLC directory from infra/pds/compose.yaml.
        case .localStack: return URL(string: "http://localhost:2582")!
        }
    }

    var appViewURL: URL {
        switch self {
        case .aws: return URL(string: "https://dev.openreel.social/appview")!
        case .devServer: return URL(string: "https://openreel.zackmurry.com/appview")!
        // compose.yaml publishes the AppView on 3001 (and media on 3006).
        case .localStack: return URL(string: "http://localhost:3001")!
        }
    }

    var isLocal: Bool { self == .localStack }
}
