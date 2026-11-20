import Foundation

public struct ReminderSpec: Equatable, Sendable {
    public var id: String
    public var taskID: String
    public var title: String
    public var body: String
    public var when: Date
    public var timeZone: String
    public init(id: String, taskID: String, title: String, body: String, when: Date, timeZone: String) { self.id = id; self.taskID = taskID; self.title = title; self.body = body; self.when = when; self.timeZone = timeZone }
}
public struct ReminderPlan: Sendable {
    public var add: [ReminderSpec]
    public var cancel: [String]
    public var scheduled: Int
    public var total: Int
    /// Do not cancel an unchanged, already due request while the OS is delivering it.
    /// Do not reset unchanged future requests on every foreground sync.
    public static func make(tasks: [TaskRecord], userID: String, timeZone: String, existing: [ReminderSpec], now: Date = Date()) -> ReminderPlan {
        let zone = TimeZone(identifier: timeZone) ?? .current
        let all = tasks.compactMap { task -> ReminderSpec? in
            guard task.userID == userID, let when = DateTools.reminder(task, zone: zone) else { return nil }
            return ReminderSpec(id: "matrica.\(userID).\(task.id)", taskID: task.id, title: task.title, body: task.note.isEmpty ? "Пора выполнить задачу" : task.note, when: when, timeZone: zone.identifier)
        }
        let upcoming = all.filter { $0.when > now }.sorted { $0.when == $1.when ? $0.id < $1.id : $0.when < $1.when }, selected = Array(upcoming.prefix(60))
        let cancel = existing.filter { old in
            guard old.id.hasPrefix("matrica."), old.id != "matrica.test" else { return false }
            if selected.contains(where: { $0.id == old.id }) { return false }
            return !all.contains(where: { $0.id == old.id && $0.when <= now && $0 == old })
        }.map(\.id)
        return ReminderPlan(add: selected.filter { !existing.contains($0) }, cancel: cancel, scheduled: selected.count, total: upcoming.count)
    }
}
