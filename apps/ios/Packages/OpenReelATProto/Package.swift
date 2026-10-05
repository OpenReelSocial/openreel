// swift-tools-version: 5.9
import PackageDescription

// Platform-neutral AT Protocol client code for the iOS app: identity
// resolution, OAuth (PAR + PKCE + DPoP), session persistence, and XRPC.
// Nothing in here imports UIKit or SwiftUI, so it can be unit-tested with
// `swift test` on macOS without booting a simulator.
let package = Package(
    name: "OpenReelATProto",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "OpenReelATProto", targets: ["OpenReelATProto"]),
    ],
    targets: [
        .target(name: "OpenReelATProto"),
        .testTarget(name: "OpenReelATProtoTests", dependencies: ["OpenReelATProto"]),
    ]
)
