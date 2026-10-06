#if canImport(Security)
import Foundation
import Security

/// Persists the session as one generic-password item. Readable only after the
/// device has been unlocked once since boot and never migrated to another
/// device via backup, which is the right posture for a DPoP private key.
public struct KeychainSessionStore: SessionStore {
    public enum KeychainError: Error, Equatable {
        case unexpectedStatus(OSStatus)
        case corruptItem
    }

    private let service: String
    private let account: String

    public init(service: String = "social.openreel.ios.atproto-session", account: String = "current") {
        self.service = service
        self.account = account
    }

    public func load() throws -> OAuthSession? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        switch status {
        case errSecSuccess:
            guard let data = item as? Data else { throw KeychainError.corruptItem }
            do {
                return try JSONDecoder().decode(OAuthSession.self, from: data)
            } catch {
                // A session written by an older build is useless; drop it
                // rather than failing every launch.
                try? clear()
                return nil
            }
        case errSecItemNotFound:
            return nil
        default:
            throw KeychainError.unexpectedStatus(status)
        }
    }

    public func save(_ session: OAuthSession) throws {
        let data = try JSONEncoder().encode(session)
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let updateStatus = SecItemUpdate(baseQuery as CFDictionary, attributes as CFDictionary)
        switch updateStatus {
        case errSecSuccess:
            return
        case errSecItemNotFound:
            var insert = baseQuery
            for (key, value) in attributes { insert[key] = value }
            let addStatus = SecItemAdd(insert as CFDictionary, nil)
            guard addStatus == errSecSuccess else { throw KeychainError.unexpectedStatus(addStatus) }
        default:
            throw KeychainError.unexpectedStatus(updateStatus)
        }
    }

    public func clear() throws {
        let status = SecItemDelete(baseQuery as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError.unexpectedStatus(status)
        }
    }

    private var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }
}
#endif
