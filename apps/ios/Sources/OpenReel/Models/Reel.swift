import Foundation

struct Reel: Identifiable, Hashable {
    let id: String
    let authorHandle: String
    let caption: String
    let videoURL: URL
}
