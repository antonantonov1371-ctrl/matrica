import Foundation
import Combine
import Network

struct LocalSnapshot: Codable { var tasks: [TaskRecord] = []; var baseline: [TaskRecord] = []; var timeZone: String = TimeZone.current.identifier }
@MainActor final class TaskStore: ObservableObject {
    @Published private(set) var snapshot = LocalSnapshot()
    @Published private(set) var session: CloudSession?
    @Published private(set) var syncing = false
    @Published var needsLogin = false
    @Published var status = ""
    @Published var error: String?
    @Published var syncError = ""
    @Published var pendingCompletion: Set<String> = []
    let reminders = LocalReminders()
    private var completionJobs: [String: Task<Void, Never>] = [:]
    private var reminderJob: Task<Void, Never>?
    private var syncJob: Task<Void, Never>?
    private let monitor = NWPathMonitor()
    private var syncAgain = false
    private var online = true
    private var localDataUnavailable = false
    var tasks: [TaskRecord] { snapshot.tasks }
    var folders: [TaskRecord] { tasks.filter { $0.isFolder }.sorted { ($0.metadata["folderRank"]?.number ?? 0) < ($1.metadata["folderRank"]?.number ?? 0) } }
    var pendingCount: Int { let baseline = Dictionary(uniqueKeysWithValues: snapshot.baseline.map { ($0.id, $0.payload) }); return tasks.filter { baseline[$0.id] != $0.payload }.count }
    init() {
        do { session = try SessionKeychain.load(); if let id = session?.user.id { snapshot = try load(id) }; status = "Локальная копия" } catch { localDataUnavailable = true; self.error = "Не удалось открыть локальные данные: \(error.localizedDescription)" }
        monitor.pathUpdateHandler = { [weak self] path in Task { @MainActor in guard let self else { return }; self.online = path.status == .satisfied; if self.online { await self.sync() } else { self.status = "Без интернета · сохранено на устройстве" } } }
        monitor.start(queue: DispatchQueue(label: "matrica.connection")); refreshReminders()
    }
    private func url(_ id: String) throws -> URL {
        guard UUID(uuidString: id) != nil else { throw CloudError.message("Некорректный аккаунт") }
        let folder = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true).appendingPathComponent("Matrica", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        return folder.appendingPathComponent(id + ".json")
    }
    private func load(_ id: String) throws -> LocalSnapshot {
        let file = try url(id); guard FileManager.default.fileExists(atPath: file.path) else { return LocalSnapshot() }
        let state = try JSONDecoder().decode(LocalSnapshot.self, from: Data(contentsOf: file))
        guard (state.tasks + state.baseline).allSatisfy({ $0.userID == id }) else { throw CloudError.message("Не совпадает владелец локальных данных") }
        return state
    }
    private func persist(_ state: LocalSnapshot, user: String) throws {
        let encoder = JSONEncoder(); encoder.outputFormatting = .sortedKeys
        let data = try encoder.encode(state), file = try url(user)
        #if os(iOS)
        try data.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        #else
        try data.write(to: file, options: .atomic)
        #endif
    }
    @discardableResult private func commit(_ state: LocalSnapshot) -> Bool {
        guard let id = session?.user.id, !localDataUnavailable else { return false }
        do { try persist(state, user: id); snapshot = state; refreshReminders(); return true }
        catch { self.error = "Изменение не сохранено: \(error.localizedDescription)"; return false }
    }
    func signIn(email: String, password: String) async {
        guard !syncing else { return }; syncing = true
        do {
            let next = try await CloudAPI.signIn(email: email.trimmingCharacters(in: .whitespacesAndNewlines), password: password)
            let state = try load(next.user.id); try SessionKeychain.save(next)
            completionJobs.values.forEach { $0.cancel() }; completionJobs = [:]; pendingCompletion = []
            snapshot = state; session = next; localDataUnavailable = false; needsLogin = false; error = nil; refreshReminders()
        } catch { self.error = error.localizedDescription }
        syncing = false; if session != nil && !needsLogin { await sync() }
    }
    func signOut() {
        guard !syncing else { return }
        do { try SessionKeychain.save(nil) } catch { self.error = error.localizedDescription; return }
        syncJob?.cancel(); completionJobs.values.forEach { $0.cancel() }; completionJobs = [:]; pendingCompletion = []
        session = nil; snapshot = LocalSnapshot(); needsLogin = false; refreshReminders()
    }
    func save(_ edited: TaskRecord, original: TaskRecord?) {
        guard edited.userID == session?.user.id, !edited.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        var state = snapshot
        if let index = state.tasks.firstIndex(where: { $0.id == edited.id }) { state.tasks[index] = TaskRecord.merge(base: original, local: edited, remote: state.tasks[index]) }
        else if original == nil { state.tasks.append(edited) } else { error = "Задача изменилась на другом устройстве. Откройте её снова."; return }
        if commit(state) { queueSync() }
    }
    func move(_ id: String, date: String, quadrant: Int) { guard var t = tasks.first(where: { $0.id == id && !$0.isFolder && !$0.deleted }) else { return }; let original = t; t.date = date; t.quadrant = quadrant; save(t, original: original) }
    func duplicate(_ id: String) { guard var t = tasks.first(where: { $0.id == id }) else { return }; t.fields["id"] = .string(UUID().uuidString.lowercased()); t.done = false; t.completedAt = ""; t.setMeta("nextOccurrenceId", nil); t.setMeta("seriesId", nil); t.setMeta("generatedFrom", nil); t.subtasks = t.subtasks.map { var s = $0.object; s["id"] = .string(UUID().uuidString.lowercased()); s["done"] = .bool(false); return .object(s) }; save(t, original: nil) }
    func trash(_ id: String) { guard var t = tasks.first(where: { $0.id == id }) else { return }; let original = t; t.trash(); completionJobs[id]?.cancel(); pendingCompletion.remove(id); save(t, original: original) }
    func restore(_ id: String) { guard var t = tasks.first(where: { $0.id == id }) else { return }; let original = t; if t.deleted { t.restore() } else { t.done = false; t.completedAt = "" }; save(t, original: original) }
    func toggle(_ id: String) {
        guard var t = tasks.first(where: { $0.id == id && !$0.deleted }) else { return }; let original = t
        completionJobs[id]?.cancel(); pendingCompletion.remove(id); t.done.toggle(); t.completedAt = t.done ? ISO8601DateFormatter().string(from: Date()) : ""
        if t.done { t.subtasks = t.subtasks.map { var s = $0.object; s["done"] = .bool(true); return .object(s) } }
        else if t.metadata["nextOccurrenceId"] != nil { t.setMeta("repeat", nil) }
        save(t, original: original)
        if t.done && tasks.first(where: { $0.id == id })?.done == true {
            pendingCompletion.insert(id)
            completionJobs[id] = Task { [weak self] in
                do { try await Task.sleep(nanoseconds: 1_800_000_000) } catch { return }
                guard let self else { return }; self.pendingCompletion.remove(id); self.completionJobs.removeValue(forKey: id); self.finishRepeat(id)
            }
        }
    }
    private func finishRepeat(_ id: String) {
        guard let index = snapshot.tasks.firstIndex(where: { $0.id == id }), snapshot.tasks[index].done else { return }
        var state = snapshot, t = state.tasks[index]
        let zone = TimeZone(identifier: state.timeZone) ?? .current
        let now = DateTools.day(Date(), zone: zone)
        let time = DateFormatter(); time.locale = Locale(identifier: "en_US_POSIX"); time.timeZone = zone; time.dateFormat = "HH:mm"
        let previous = DateTools.calendar.date(byAdding: .day, value: -1, to: DateTools.parse(now)!)!
        let cutoff = t.time.isEmpty || t.time > time.string(from: Date()) ? DateTools.day(previous, zone: DateTools.calendar.timeZone) : now
        guard let next = t.nextOccurrence(after: cutoff) else { return }
        t.setMeta("nextOccurrenceId", .string(next.id)); t.setMeta("seriesId", next.metadata["seriesId"]); state.tasks[index] = t
        if !state.tasks.contains(where: { $0.id == next.id }) { state.tasks.append(next) }
        if commit(state) { queueSync() }
    }
    func snooze(_ id: String, minutes: Int) {
        guard var t = tasks.first(where: { $0.id == id }) else { return }; let original = t, date = Date().addingTimeInterval(Double(minutes * 60)), zone = TimeZone(identifier: snapshot.timeZone) ?? .current
        let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = zone; f.dateFormat = "HH:mm"; t.date = DateTools.day(date, zone: zone); t.time = f.string(from: date); save(t, original: original)
    }
    private func queueSync() { if syncing { syncAgain = true; return }; syncJob?.cancel(); syncJob = Task { [weak self] in do { try await Task.sleep(nanoseconds: 500_000_000) } catch { return }; await self?.sync() } }
    func refreshReminders() { let rows = tasks, id = session?.user.id, zone = snapshot.timeZone; reminderJob = Task { [weak self] in await self?.reminders.reconcile(rows, userID: id, timeZone: zone) } }
    func sync() async {
        guard !syncing, !localDataUnavailable, var current = session else { return }
        guard online else { status = "Без интернета · сохранено на устройстве"; return }
        syncing = true; status = "Синхронизация…"; var success = false
        defer { syncing = false; if success && syncAgain { syncAgain = false; queueSync() } }
        do {
            if (current.expires_at ?? 0) < Date().timeIntervalSince1970 + 60 { current = try await CloudAPI.refresh(current); try SessionKeychain.save(current); session = current }
            let remote = try await CloudAPI.tasks(current)
            guard session?.user.id == current.user.id else { return }
            let local = Dictionary(uniqueKeysWithValues: tasks.map { ($0.id, $0) }), baseline = Dictionary(uniqueKeysWithValues: snapshot.baseline.map { ($0.id, $0) }), remoteIDs = Set(remote.map(\.id))
            var state = snapshot
            state.tasks = remote.map { row in guard let own = local[row.id], own.payload != baseline[row.id]?.payload else { return row }; return TaskRecord.merge(base: baseline[row.id], local: own, remote: row) }
            state.tasks += tasks.filter { !remoteIDs.contains($0.id) && $0.payload != baseline[$0.id]?.payload }
            state.baseline = remote
            guard commit(state) else { throw CloudError.message("Не удалось сохранить локальную копию. Синхронизация остановлена.") }
            let remoteByID = Dictionary(uniqueKeysWithValues: remote.map { ($0.id, $0.payload) })
            let changed = tasks.filter { $0.payload != remoteByID[$0.id] }
            let generated = changed.filter { remoteByID[$0.id] == nil && $0.metadata["generatedFrom"] != nil }, regular = changed.filter { row in !generated.contains(where: { $0.id == row.id }) }
            for batch in [generated, regular] where !batch.isEmpty {
                let isGenerated = batch.first.map { row in generated.contains(where: { $0.id == row.id }) } ?? false
                let acknowledged = try await CloudAPI.save(batch, session: current, generated: isGenerated)
                var next = snapshot
                for ack in acknowledged {
                    if let sent = batch.first(where: { $0.id == ack.id }), let i = next.tasks.firstIndex(where: { $0.id == ack.id }) { next.tasks[i] = TaskRecord.merge(base: sent, local: next.tasks[i], remote: ack) }
                    next.baseline.removeAll { $0.id == ack.id }; next.baseline.append(ack)
                }
                guard commit(next) else { throw CloudError.message("Не удалось сохранить подтверждение синхронизации") }
                if isGenerated && acknowledged.count < batch.count { syncAgain = true }
            }
            if let zone = try? await CloudAPI.zone(current) { var next = snapshot; next.timeZone = zone; _ = commit(next) }
            needsLogin = false; syncError = ""; success = true; status = pendingCount == 0 ? "Синхронизировано" : "Сохранено на устройстве · ожидает отправки"
            let unfinished = tasks.filter { $0.done && !$0.repeating.isEmpty && $0.metadata["nextOccurrenceId"] == nil && !pendingCompletion.contains($0.id) }.map(\.id)
            for id in unfinished { finishRepeat(id) }
        } catch {
            if case CloudError.expired = error { needsLogin = true }
            status = "Изменения сохранены на устройстве · синхронизация недоступна"
            self.syncError = error.localizedDescription
        }
    }
}
