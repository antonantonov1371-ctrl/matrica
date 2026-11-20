import XCTest
@testable import MatricaCore

final class ReminderPlanTests: XCTestCase {
    let zone = "Europe/Moscow"
    let now = ISO8601DateFormatter().date(from: "2026-11-20T06:00:00Z")!
    func task(time: String = "09:00") -> TaskRecord { var t = TaskRecord.new(userID: "owner", date: "2026-11-20"); t.title = "Позвонить"; t.time = time; return t }
    func spec(_ task: TaskRecord) -> ReminderSpec { ReminderSpec(id: "matrica.owner.\(task.id)", taskID: task.id, title: task.title, body: "Пора выполнить задачу", when: DateTools.reminder(task, zone: TimeZone(identifier: zone)!)!, timeZone: zone) }
    func testSyncDoesNotCancelNotificationBeingDelivered() {
        let t = task(), old = spec(t)
        let plan = ReminderPlan.make(tasks: [t], userID: "owner", timeZone: zone, existing: [old], now: now.addingTimeInterval(2))
        XCTAssertTrue(plan.cancel.isEmpty); XCTAssertTrue(plan.add.isEmpty)
    }
    func testUnchangedFutureReminderIsNotRescheduled() {
        let t = task(time: "10:00"), old = spec(t)
        let plan = ReminderPlan.make(tasks: [t], userID: "owner", timeZone: zone, existing: [old], now: now)
        XCTAssertTrue(plan.cancel.isEmpty); XCTAssertTrue(plan.add.isEmpty); XCTAssertEqual(plan.scheduled, 1)
    }
    func testCompletionCancelsExistingReminder() {
        var t = task(time: "10:00"); let old = spec(t); t.done = true
        let plan = ReminderPlan.make(tasks: [t], userID: "owner", timeZone: zone, existing: [old], now: now)
        XCTAssertEqual(plan.cancel, [old.id]); XCTAssertTrue(plan.add.isEmpty)
    }
    func testChangingTimeReplacesRequestWithSameID() {
        var t = task(time: "10:00"); let old = spec(t); t.time = "11:00"
        let plan = ReminderPlan.make(tasks: [t], userID: "owner", timeZone: zone, existing: [old], now: now)
        XCTAssertEqual(plan.add.first?.id, old.id); XCTAssertNotEqual(plan.add.first?.when, old.when); XCTAssertTrue(plan.cancel.isEmpty)
    }
    func testKeepsTestNotificationAndUsesNearestSixty() {
        let tasks = (0..<61).map { i -> TaskRecord in var t = task(time: "10:00"); t.fields["id"] = .string("task-\(i)"); return t }
        let test = ReminderSpec(id: "matrica.test", taskID: "", title: "Проверка", body: "", when: now.addingTimeInterval(5), timeZone: zone)
        let plan = ReminderPlan.make(tasks: tasks, userID: "owner", timeZone: zone, existing: [test], now: now)
        XCTAssertEqual(plan.total, 61); XCTAssertEqual(plan.scheduled, 60); XCTAssertEqual(plan.add.count, 60); XCTAssertFalse(plan.cancel.contains(test.id))
    }
    func testPreviousAccountRequestsAreCancelled() {
        let t = task(time: "10:00"), old = spec(t)
        let plan = ReminderPlan.make(tasks: [], userID: "another-owner", timeZone: zone, existing: [old], now: now)
        XCTAssertEqual(plan.cancel, [old.id]); XCTAssertTrue(plan.add.isEmpty)
    }
}
