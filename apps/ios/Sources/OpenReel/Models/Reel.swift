import Foundation

struct Reel: Identifiable, Hashable {
    let id: String
    let authorHandle: String
    let caption: String
    let videoURL: URL
    var labels: [ContentLabel] = []
}

/// A moderation label shown on a reel, and the labeler that applied it.
struct ContentLabel: Hashable {
    let name: String
    let labeler: String
}
