import Foundation

public enum JSONValue: Codable, Equatable, Sendable {
    case string(String), number(Double), bool(Bool), object([String: JSONValue]), array([JSONValue]), null
    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let v = try? c.decode(Bool.self) { self = .bool(v) }
        else if let v = try? c.decode(Double.self) { self = .number(v) }
        else if let v = try? c.decode(String.self) { self = .string(v) }
        else if let v = try? c.decode([String: JSONValue].self) { self = .object(v) }
        else { self = .array(try c.decode([JSONValue].self)) }
    }
    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .string(let v): try c.encode(v)
        case .number(let v): try c.encode(v)
        case .bool(let v): try c.encode(v)
        case .object(let v): try c.encode(v)
        case .array(let v): try c.encode(v)
        case .null: try c.encodeNil()
        }
    }
    public var string: String { if case .string(let s) = self { return s }; return "" }
    public var object: [String: JSONValue] { if case .object(let v) = self { return v }; return [:] }
    public var array: [JSONValue] { if case .array(let v) = self { return v }; return [] }
    public var bool: Bool { self == .bool(true) }
    public var number: Double { if case .number(let v) = self { return v }; return 0 }
}

/// Retains the existing database row and unknown metadata; no migration or task deletion.
public struct TaskRecord: Codable, Equatable, Identifiable, Sendable {
    public var fields: [String: JSONValue]
    public init(fields: [String: JSONValue]) { self.fields = fields }
    public init(from decoder: Decoder) throws { fields = try decoder.singleValueContainer().decode([String: JSONValue].self) }
    public func encode(to encoder: Encoder) throws { var c = encoder.singleValueContainer(); try c.encode(fields) }
    public var id: String { fields["id"]?.string ?? "" }
    public var userID: String { fields["user_id"]?.string ?? "" }
    public var title: String { get { fields["title"]?.string ?? "" } set { fields["title"] = .string(newValue) } }
    public var date: String { get { fields["task_date"]?.string ?? "" } set { fields["task_date"] = newValue.isEmpty ? .null : .string(newValue); if newValue.isEmpty { fields["quadrant"] = .null } } }
    public var time: String { get { String((fields["task_time"]?.string ?? "").prefix(5)) } set { fields["task_time"] = newValue.isEmpty ? .null : .string(newValue) } }
    public var quadrant: Int { get { fields["quadrant"] == nil || fields["quadrant"] == .null ? 1 : max(0, min(3, Int(fields["quadrant"]?.number ?? 2) - 1)) } set { fields["quadrant"] = date.isEmpty ? .null : .number(Double(newValue + 1)) } }
    public var done: Bool { get { fields["completed"]?.bool ?? false } set { fields["completed"] = .bool(newValue) } }
    public var completedAt: String { get { fields["completed_at"]?.string ?? "" } set { fields["completed_at"] = newValue.isEmpty ? .null : .string(newValue) } }
    public var envelope: [String: JSONValue]? {
        guard let data = fields["description"]?.string.data(using: .utf8), let m = try? JSONDecoder().decode([String: JSONValue].self, from: data), m["matrica"] == .number(2) else { return nil }; return m
    }
    public var metadata: [String: JSONValue] { envelope ?? ["matrica": .number(2), "kind": .string("task"), "note": .string(fields["description"]?.string ?? ""), "folderId": .string("")] }
    public mutating func setMeta(_ key: String, _ value: JSONValue?) {
        var m = metadata; m[key] = value
        let encoder = JSONEncoder(); encoder.outputFormatting = .sortedKeys
        if let d = try? encoder.encode(m), let s = String(data: d, encoding: .utf8) { fields["description"] = .string(s) }
    }
    public var note: String { get { metadata["note"]?.string ?? "" } set { setMeta("note", .string(newValue)) } }
    public var folderID: String { get { metadata["folderId"]?.string ?? "" } set { setMeta("folderId", .string(newValue)) } }
    public var isFolder: Bool { metadata["kind"] == .string("folder") }
    public var deleted: Bool { !(metadata["deletedAt"]?.string ?? "").isEmpty }
    public var flagged: Bool { get { metadata["flagged"]?.bool ?? false } set { setMeta("flagged", newValue ? .bool(true) : nil) } }
    public var tags: [String] { get { metadata["tags"]?.array.map(\.string) ?? [] } set { setMeta("tags", .array(newValue.map(JSONValue.string))) } }
    public var subtasks: [JSONValue] { get { metadata["subtasks"]?.array ?? [] } set { setMeta("subtasks", .array(newValue)) } }
    public var repeating: [String: JSONValue] { metadata["repeat"]?.object ?? [:] }
    public var rank: Double { metadata["rank"]?.number ?? 0 }
    public var payload: TaskRecord {
        let names: Set<String> = ["id", "user_id", "title", "description", "task_date", "task_time", "quadrant", "completed", "completed_at", "created_at"]
        return TaskRecord(fields: fields.filter { names.contains($0.key) })
    }
    public static func new(userID: String, date: String = "", quadrant: Int = 1, folder: Bool = false) -> TaskRecord {
        var t = TaskRecord(fields: ["id": .string(UUID().uuidString.lowercased()), "user_id": .string(userID), "title": .string(""), "description": .string(""), "created_at": .string(ISO8601DateFormatter().string(from: Date())), "completed": .bool(false), "completed_at": .null, "task_time": .null])
        t.date = date; t.quadrant = quadrant
        if folder { t.setMeta("kind", .string("folder")) }
        return t
    }
    public mutating func trash(now: String = ISO8601DateFormatter().string(from: Date())) {
        guard !isFolder, !deleted else { return }
        setMeta("deletedState", .object(["done": .bool(done), "completedAt": fields["completed_at"] ?? .null])); setMeta("deletedAt", .string(now)); done = true
        if completedAt.isEmpty { completedAt = now }
    }
    public mutating func restore() {
        let previous = metadata["deletedState"]?.object ?? [:]
        done = previous["done"]?.bool ?? false; fields["completed_at"] = previous["completedAt"] ?? .null
        setMeta("deletedAt", nil); setMeta("deletedState", nil)
    }
    public static func merge(base: TaskRecord?, local: TaskRecord, remote: TaskRecord) -> TaskRecord {
        guard let base else { return local.metadata["generatedFrom"] == nil ? local : remote }
        var out = remote
        for (key, value) in local.fields where value != base.fields[key] && key != "description" && key != "updated_at" { out.fields[key] = value }
        if local.fields["description"] != base.fields["description"] {
            if local.envelope == nil && remote.envelope == nil { out.fields["description"] = local.fields["description"] }
            else {
                var m = remote.metadata
                for key in Set(base.metadata.keys).union(local.metadata.keys) where local.metadata[key] != base.metadata[key] {
                    if key == "subtasks" { m[key] = .array(mergeSubtasks(base.subtasks, local.subtasks, remote.subtasks)) }
                    else { m[key] = local.metadata[key] }
                }
                let e = JSONEncoder(); e.outputFormatting = .sortedKeys
                if let d = try? e.encode(m), let s = String(data: d, encoding: .utf8) { out.fields["description"] = .string(s) }
            }
        }
        return out
    }
    private static func mergeSubtasks(_ base: [JSONValue], _ local: [JSONValue], _ remote: [JSONValue]) -> [JSONValue] {
        func map(_ list: [JSONValue]) -> [String: JSONValue] { list.reduce(into: [:]) { if let id = $1.object["id"]?.string { $0[id] = $1 } } }
        let b = map(base), l = map(local)
        var out = remote.filter { let id = $0.object["id"]?.string ?? ""; return b[id] == nil || l[id] != nil }.map { value -> JSONValue in
            let id = value.object["id"]?.string ?? ""; guard let own = l[id] else { return value }
            guard let old = b[id] else { return own }; var merged = value.object
            for key in Set(old.object.keys).union(own.object.keys) where old.object[key] != own.object[key] { merged[key] = own.object[key] }
            return .object(merged)
        }
        let present = Set(out.compactMap { $0.object["id"]?.string })
        out += local.filter { let id = $0.object["id"]?.string ?? ""; return !present.contains(id) && (b[id] == nil || b[id] != $0) }
        return out
    }
    public static func occurrenceID(series: String, date: String) -> String {
        var hex = ""
        for seed in UInt32(0)..<UInt32(4) {
            var h: UInt32 = 2166136261 ^ (seed &* 2654435761)
            for c in (series + "|" + date).utf16 { h = (h ^ UInt32(c)) &* 16777619 }
            hex += String(format: "%08x", h)
        }
        var c = Array(hex); c[12] = "5"; c[16] = "a"
        return String(c[0..<8]) + "-" + String(c[8..<12]) + "-" + String(c[12..<16]) + "-" + String(c[16..<20]) + "-" + String(c[20..<32])
    }
    public func nextOccurrence(after: String) -> TaskRecord? {
        guard done, !deleted, !isFolder, metadata["nextOccurrenceId"] == nil, let start = DateTools.parse(date) else { return nil }
        let rule = repeating, freq = rule["freq"]?.string ?? "", interval = max(1, min(365, Int(rule["interval"]?.number ?? 1)))
        guard ["day", "week", "month", "year", "weekdays"].contains(freq) else { return nil }
        let cal = DateTools.calendar, anchorDay = Int(rule["anchorDay"]?.number ?? Double(cal.component(.day, from: start))), anchorMonth = Int(rule["anchorMonth"]?.number ?? Double(cal.component(.month, from: start)))
        for step in 1...20000 {
            var candidate: Date?
            switch freq {
            case "day": candidate = cal.date(byAdding: .day, value: step * interval, to: start)
            case "week": candidate = cal.date(byAdding: .day, value: step * interval * 7, to: start)
            case "weekdays": candidate = cal.date(byAdding: .day, value: step, to: start); if let d = candidate, [1, 7].contains(cal.component(.weekday, from: d)) { continue }
            default:
                var parts = cal.dateComponents([.year, .month], from: start); parts.day = 1; parts.hour = 12
                if freq == "year" { parts.year! += step * interval; parts.month = anchorMonth }
                guard let first = cal.date(from: parts), let month = freq == "month" ? cal.date(byAdding: .month, value: step * interval, to: first) : first else { return nil }
                candidate = cal.date(byAdding: .day, value: min(anchorDay, cal.range(of: .day, in: .month, for: month)!.count) - 1, to: month)
            }
            guard let candidate else { continue }; let next = DateTools.day(candidate), until = rule["until"]?.string ?? ""
            if !until.isEmpty && next > until { return nil }; if next <= after { continue }
            let series = metadata["seriesId"]?.string ?? id
            var t = self; t.fields["id"] = .string(Self.occurrenceID(series: series, date: next)); t.fields["created_at"] = .string(ISO8601DateFormatter().string(from: Date())); t.fields.removeValue(forKey: "updated_at")
            t.date = next; t.done = false; t.completedAt = ""; t.setMeta("deletedAt", nil); t.setMeta("deletedState", nil); t.setMeta("nextOccurrenceId", nil); t.setMeta("seriesId", .string(series)); t.setMeta("generatedFrom", .string(id))
            t.subtasks = subtasks.map { var s = $0.object; s["done"] = .bool(false); return .object(s) }
            var anchored = rule; anchored["anchorDay"] = .number(Double(anchorDay)); anchored["anchorMonth"] = .number(Double(anchorMonth)); t.setMeta("repeat", .object(anchored)); return t
        }
        return nil
    }
}

public enum DateTools {
    public static var calendar: Calendar { var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone(secondsFromGMT: 0)!; return c }
    public static func day(_ date: Date, zone: TimeZone = .current) -> String { let f = DateFormatter(); f.calendar = Calendar(identifier: .gregorian); f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = zone; f.dateFormat = "yyyy-MM-dd"; return f.string(from: date) }
    public static func parse(_ value: String) -> Date? { let f = DateFormatter(); f.calendar = calendar; f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = calendar.timeZone; f.dateFormat = "yyyy-MM-dd"; f.isLenient = false; guard let d = f.date(from: value), day(d, zone: calendar.timeZone) == value else { return nil }; return d }
    public static func reminder(_ task: TaskRecord, zone: TimeZone) -> Date? {
        guard !task.isFolder, !task.done, !task.deleted, !task.date.isEmpty, !task.time.isEmpty else { return nil }
        let f = DateFormatter(); f.calendar = Calendar(identifier: .gregorian); f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = zone; f.dateFormat = "yyyy-MM-dd HH:mm"; f.isLenient = false
        return f.date(from: task.date + " " + task.time)
    }
}
