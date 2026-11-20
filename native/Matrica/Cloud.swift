import Foundation
import Security

struct CloudUser: Codable { let id: String; let email: String? }
struct CloudSession: Codable {
    var access_token: String
    var refresh_token: String
    var expires_at: Double?
    var expires_in: Double?
    var user: CloudUser
    mutating func anchorExpiry() { if expires_at == nil { expires_at = Date().timeIntervalSince1970 + (expires_in ?? 3600) } }
}
enum CloudError: LocalizedError {
    case message(String), expired, storage
    var errorDescription: String? { switch self { case .message(let s): return s; case .expired: return "Войдите снова для синхронизации. Локальные изменения сохранены."; case .storage: return "Не удалось сохранить вход в Связке ключей." } }
}
enum SessionKeychain {
    static let service = "matrica.native.session.v1"
    static func load() throws -> CloudSession? {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: "current", kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var result: CFTypeRef?; let status = SecItemCopyMatching(q as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw CloudError.storage }
        return try JSONDecoder().decode(CloudSession.self, from: data)
    }
    static func save(_ value: CloudSession?) throws {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: "current"]
        guard let value else { let s = SecItemDelete(q as CFDictionary); if s != errSecSuccess && s != errSecItemNotFound { throw CloudError.storage }; return }
        let attributes: [String: Any] = [kSecValueData as String: try JSONEncoder().encode(value), kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        let status = SecItemUpdate(q as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound { guard SecItemAdd(q.merging(attributes) { _, new in new } as CFDictionary, nil) == errSecSuccess else { throw CloudError.storage } }
        else if status != errSecSuccess { throw CloudError.storage }
    }
}
enum CloudAPI {
    // Public project key only. Every data request also uses the user's JWT and existing RLS.
    static let base = "https://qageovdipbmegxfcsvdp.supabase.co"
    static let key = "sb_publishable_S6jh0juDi-9tXB9OMY-now_qe53hTrc"
    static func request(_ path: String, method: String = "GET", body: Data? = nil, token: String? = nil, headers: [String: String] = [:]) async throws -> Data {
        guard let url = URL(string: base + path) else { throw CloudError.message("Некорректный адрес сервера") }
        var r = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20)
        r.httpMethod = method; r.httpBody = body; r.setValue(key, forHTTPHeaderField: "apikey"); r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token { r.setValue("Bearer " + token, forHTTPHeaderField: "Authorization") }
        for (k, v) in headers { r.setValue(v, forHTTPHeaderField: k) }
        let (data, response) = try await URLSession.shared.data(for: r)
        guard let response = response as? HTTPURLResponse else { throw CloudError.message("Сервер не ответил") }
        if response.statusCode == 401 { throw CloudError.expired }
        guard (200..<300).contains(response.statusCode) else {
            let message = (try? JSONDecoder().decode([String: JSONValue].self, from: data)) ?? [:]
            throw CloudError.message(message["msg"]?.string ?? message["message"]?.string ?? message["error_description"]?.string ?? "Не удалось синхронизировать изменения")
        }
        return data
    }
    static func signIn(email: String, password: String) async throws -> CloudSession {
        let body = try JSONEncoder().encode(["email": email, "password": password])
        let data = try await request("/auth/v1/token?grant_type=password", method: "POST", body: body)
        var session = try JSONDecoder().decode(CloudSession.self, from: data); session.anchorExpiry(); return session
    }
    static func refresh(_ old: CloudSession) async throws -> CloudSession {
        let body = try JSONEncoder().encode(["refresh_token": old.refresh_token])
        let data = try await request("/auth/v1/token?grant_type=refresh_token", method: "POST", body: body)
        var session = try JSONDecoder().decode(CloudSession.self, from: data); session.anchorExpiry(); return session
    }
    static func tasks(_ session: CloudSession) async throws -> [TaskRecord] {
        var out: [String: TaskRecord] = [:], offset = 0
        while true {
            let data = try await request("/rest/v1/tasks?user_id=eq.\(session.user.id)&select=*&order=id.asc&limit=500&offset=\(offset)", token: session.access_token)
            let page = try JSONDecoder().decode([TaskRecord].self, from: data)
            guard page.allSatisfy({ $0.userID == session.user.id && UUID(uuidString: $0.id) != nil }) else { throw CloudError.message("Не удалось проверить владельца задач") }
            for row in page { out[row.id] = row }; if page.count < 500 { return out.values.sorted { $0.id < $1.id } }; offset += page.count
        }
    }
    static func save(_ tasks: [TaskRecord], session: CloudSession, generated: Bool = false) async throws -> [TaskRecord] {
        guard !tasks.isEmpty else { return [] }
        guard tasks.allSatisfy({ $0.userID == session.user.id }) else { throw CloudError.message("Аккаунт изменился. Изменения сохранены локально.") }
        let body = try JSONEncoder().encode(tasks.map(\.payload))
        let data = try await request("/rest/v1/tasks?on_conflict=id", method: "POST", body: body, token: session.access_token, headers: ["Prefer": "resolution=\(generated ? "ignore" : "merge")-duplicates,return=representation"])
        return try JSONDecoder().decode([TaskRecord].self, from: data)
    }
    static func zone(_ session: CloudSession) async throws -> String? {
        let data = try await request("/rest/v1/notification_preferences?user_id=eq.\(session.user.id)&select=time_zone&limit=1", token: session.access_token)
        return try JSONDecoder().decode([[String: String]].self, from: data).first?["time_zone"]
    }
}
