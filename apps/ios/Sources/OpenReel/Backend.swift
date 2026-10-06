import Foundation

/// The OpenReel deployment this build talks to: the PDS and PLC directory it
/// signs in against (Debug only; see AppAuthConfiguration) and the AppView
/// its feed reads from.
enum Backend {
    /// The shared dev/demo server (ADR-0005): PDS at the root, PLC under
    /// `/plc`, AppView under `/appview`, media under `/media`.
    case devServer
    /// The Compose stack from the repository root (`make up`). Simulator only:
    /// a device cannot reach the Mac's localhost.
    case localStack

    /// Debug builds use the dev server unless the scheme's Run environment
    /// sets `OPENREEL_BACKEND=local`. Release builds always use the dev
    /// server, the only deployed AppView.
    static let current: Backend = {
        #if DEBUG
        if ProcessInfo.processInfo.environment["OPENREEL_BACKEND"] == "local" {
            return .localStack
        }
        #endif
        return .devServer
    }()

    var pdsURL: URL {
        switch self {
        case .devServer: return URL(string: "https://openreel.zackmurry.com")!
        // infra/pds/compose.yaml publishes the PDS on 3000.
        case .localStack: return URL(string: "http://localhost:3000")!
        }
    }

    var plcURL: URL {
        switch self {
        case .devServer: return URL(string: "https://openreel.zackmurry.com/plc")!
        // The private PLC directory from infra/pds/compose.yaml.
        case .localStack: return URL(string: "http://localhost:2582")!
        }
    }

    var appViewURL: URL {
        switch self {
        case .devServer: return URL(string: "https://openreel.zackmurry.com/appview")!
        // compose.yaml publishes the AppView on 3001 (and media on 3006).
        case .localStack: return URL(string: "http://localhost:3001")!
        }
    }

    var isLocal: Bool { self == .localStack }
}
