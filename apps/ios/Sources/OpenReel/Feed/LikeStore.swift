import Foundation
import Observation
import OpenReelATProto

/// The signed-in viewer's likes, kept as `social.openreel.engagement.like`
/// records in their own repository. Which posts the viewer likes is read from
/// that repository, not the AppView; the counts come from the AppView, which
/// learns of a like a moment after it is written, so this adds the viewer's
/// own change on top until the count it was applied to moves.
@MainActor
@Observable
final class LikeStore {
    /// Like record URIs by liked post URI. An empty list is a like still
    /// being written. Usually one record per post, but another client could
    /// have written more; unliking deletes them all.
    private(set) var likes: [String: [String]] = [:]
    /// The viewer's change to a post's count, and the AppView count it was
    /// made against.
    private var adjustments: [String: Adjustment] = [:]

    /// Posts with a write in flight; taps on them wait for it to land.
    @ObservationIgnored private var pending: Set<String> = []
    /// The account whose likes are loaded.
    @ObservationIgnored private var loadedDID: String?

    private let auth: AuthController
    /// Stop reading after this many pages of 100.
    private static let maxPages = 20

    private struct Adjustment {
        let base: Int
        let delta: Int
    }

    init(auth: AuthController) {
        self.auth = auth
    }

    func isLiked(_ reel: Reel) -> Bool {
        likes[reel.id] != nil
    }

    func likeCount(_ reel: Reel) -> Int {
        guard let adjustment = adjustments[reel.id], adjustment.base == reel.likeCount else {
            return reel.likeCount
        }
        return max(0, reel.likeCount + adjustment.delta)
    }

    /// Loads the signed-in account's likes from its repository, and forgets
    /// those of an account that signed out. Call whenever the account changes.
    func sync() async {
        let did = auth.session?.did.rawValue
        guard did != loadedDID else { return }
        likes = [:]
        adjustments = [:]
        pending = []
        loadedDID = did
        guard let did else { return }

        var found: [String: [String]] = [:]
        var cursor: String?
        do {
            for _ in 0..<Self.maxPages {
                let page = try await auth.manager.listRecords(
                    collection: LikeRecord.collection,
                    as: RecordSubject.self,
                    cursor: cursor
                )
                for record in page.records {
                    if let subject = record.value?.subject.uri {
                        found[subject, default: []].append(record.uri)
                    }
                }
                cursor = page.cursor
                if cursor == nil || page.records.isEmpty { break }
            }
        } catch {
            // Hearts start empty; the next sign-in tries again.
            print("[likes] could not list likes: \(error)")
            if loadedDID == did { loadedDID = nil }
            return
        }
        guard loadedDID == did else { return }
        // Taps made while the list loaded win over what it found.
        likes = found.merging(likes) { _, local in local }
    }

    func toggle(_ reel: Reel) {
        guard auth.session != nil, !pending.contains(reel.id) else { return }
        if let uris = likes[reel.id] {
            unlike(reel, records: uris)
        } else {
            like(reel)
        }
    }

    private func like(_ reel: Reel) {
        likes[reel.id] = []
        adjust(reel, by: 1)
        pending.insert(reel.id)
        let record = LikeRecord(subject: StrongRef(uri: reel.id, cid: reel.cid))
        let manager = auth.manager
        Task {
            defer { pending.remove(reel.id) }
            do {
                let output = try await manager.createRecord(collection: LikeRecord.collection, record: record)
                likes[reel.id] = [output.uri]
            } catch {
                print("[likes] could not like \(reel.id): \(error)")
                likes[reel.id] = nil
                adjust(reel, by: -1)
            }
        }
    }

    private func unlike(_ reel: Reel, records uris: [String]) {
        likes[reel.id] = nil
        adjust(reel, by: -1)
        pending.insert(reel.id)
        let manager = auth.manager
        Task {
            defer { pending.remove(reel.id) }
            do {
                for uri in uris {
                    // at://<did>/<collection>/<rkey>
                    guard let rkey = uri.split(separator: "/").last else { continue }
                    try await manager.deleteRecord(collection: LikeRecord.collection, rkey: String(rkey))
                }
            } catch {
                print("[likes] could not unlike \(reel.id): \(error)")
                likes[reel.id] = uris
                adjust(reel, by: 1)
            }
        }
    }

    private func adjust(_ reel: Reel, by change: Int) {
        let current = adjustments[reel.id].flatMap { $0.base == reel.likeCount ? $0.delta : nil } ?? 0
        let delta = current + change
        adjustments[reel.id] = delta == 0 ? nil : Adjustment(base: reel.likeCount, delta: delta)
    }
}
