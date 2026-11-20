import XCTest
@testable import MatricaCore

final class TaskRecordTests: XCTestCase {
    func task() -> TaskRecord { var t = TaskRecord.new(userID: "test-user", date: "2026-11-20"); t.title = "Задача"; t.note = "Описание"; return t }
    func testLegacyDescriptionSurvivesRoundTrip() throws {
        let data = Data(#"{"id":"a","user_id":"owner","title":"Старая","description":"обычный текст","task_date":null,"quadrant":null,"completed":false}"#.utf8)
        let t = try JSONDecoder().decode(TaskRecord.self, from: data)
        XCTAssertEqual(t.note, "обычный текст"); XCTAssertEqual(t.quadrant, 1)
        XCTAssertEqual(try JSONDecoder().decode(TaskRecord.self, from: JSONEncoder().encode(t)), t)
    }
    func testUnknownMetadataSurvivesEditing() {
        var t = task(); t.setMeta("futureFeature", .object(["keep": .bool(true)])); t.note = "Изменение"; t.date = "2026-12-01"
        XCTAssertEqual(t.metadata["futureFeature"], .object(["keep": .bool(true)]))
    }
    func testIndependentDeviceChangesMerge() {
        let base = task(); var phone = base, mac = base; phone.note = "Телефон"; mac.title = "Mac"
        let merged = TaskRecord.merge(base: base, local: mac, remote: phone)
        XCTAssertEqual(merged.title, "Mac"); XCTAssertEqual(merged.note, "Телефон")
    }
    func testIndependentMetadataChangesMerge() {
        let base = task(); var phone = base, mac = base; phone.flagged = true; mac.tags = ["работа"]
        let merged = TaskRecord.merge(base: base, local: mac, remote: phone)
        XCTAssertTrue(merged.flagged); XCTAssertEqual(merged.tags, ["работа"])
    }
    func testNestedSubtaskChangesMergeWithoutDiscardingUnknownKeys() {
        var base = task(); base.subtasks = [.object(["id": .string("s"), "title": .string("Шаг"), "done": .bool(false), "future": .number(42)])]
        var local = base, remote = base
        var l = local.subtasks[0].object; l["title"] = .string("Новое название"); local.subtasks = [.object(l)]
        var r = remote.subtasks[0].object; r["done"] = .bool(true); remote.subtasks = [.object(r)]
        let merged = TaskRecord.merge(base: base, local: local, remote: remote).subtasks[0].object
        XCTAssertEqual(merged["title"], .string("Новое название")); XCTAssertEqual(merged["done"], .bool(true)); XCTAssertEqual(merged["future"], .number(42))
    }
    func testTrashIsReversibleAndPreservesTaskFields() {
        var t = task(); t.tags = ["дом"]; let before = t; t.trash(now: "2026-11-20T10:00:00Z")
        XCTAssertTrue(t.deleted); XCTAssertTrue(t.done); XCTAssertNil(DateTools.reminder(t, zone: .current))
        t.restore(); XCTAssertFalse(t.deleted); XCTAssertFalse(t.done); XCTAssertEqual(t.note, before.note); XCTAssertEqual(t.tags, before.tags); XCTAssertEqual(t.id, before.id)
    }
    func testReminderUsesAccountTimezoneAndCancelsCompletedTask() {
        var t = task(); t.time = "09:00"
        XCTAssertEqual(DateTools.reminder(t, zone: TimeZone(identifier: "Europe/Moscow")!), ISO8601DateFormatter().date(from: "2026-11-20T06:00:00Z"))
        t.done = true; XCTAssertNil(DateTools.reminder(t, zone: .current))
    }
    func testRecurrenceClampsAndKeepsAnchor() {
        var t = task(); t.date = "2026-01-31"; t.done = true; t.setMeta("repeat", .object(["freq": .string("month"), "interval": .number(1)]))
        var next = t.nextOccurrence(after: "2026-01-31")!; XCTAssertEqual(next.date, "2026-02-28"); XCTAssertFalse(next.done)
        next.done = true; XCTAssertEqual(next.nextOccurrence(after: "2026-02-28")?.date, "2026-03-31")
    }
    func testWeekdaysAndEndDate() {
        var t = task(); t.done = true; t.setMeta("repeat", .object(["freq": .string("weekdays"), "interval": .number(1), "until": .string("2026-11-23")]))
        XCTAssertEqual(t.nextOccurrence(after: "2026-11-20")?.date, "2026-11-23"); XCTAssertNil(t.nextOccurrence(after: "2026-11-23"))
    }
    func testRepeatedGenerationIsStableAndDoesNotMutateSource() {
        var t = task(); t.done = true; t.setMeta("repeat", .object(["freq": .string("day"), "interval": .number(1)])); let before = t
        XCTAssertEqual(t.nextOccurrence(after: t.date)?.id, t.nextOccurrence(after: t.date)?.id); XCTAssertEqual(t, before)
    }
    func testDoesNotDeleteUnknownRemoteTask() {
        let remote = task(); let retained = [remote].map { TaskRecord.merge(base: nil, local: $0, remote: $0) }; XCTAssertEqual(retained, [remote])
    }
    func testWebCompatibilityVectors() throws {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("Compatibility.json")
        let vectors = try JSONDecoder().decode([[String: JSONValue]].self, from: Data(contentsOf: url))
        for v in vectors { XCTAssertEqual(TaskRecord.occurrenceID(series: v["series"]!.string, date: v["date"]!.string), v["id"]!.string) }
    }
}
