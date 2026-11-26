import Foundation
import UserNotifications
import Combine

@MainActor final class LocalReminders: NSObject, ObservableObject, UNUserNotificationCenterDelegate {
    @Published var permission: UNAuthorizationStatus = .notDetermined
    @Published var scheduled = 0
    @Published var total = 0
    @Published var error = ""
    @Published var openedTask: String?
    private var latest: ([TaskRecord], String?, String)?
    private var reconciling = false
    private let center = UNUserNotificationCenter.current()
    override init() { super.init(); center.delegate = self }
    func checkPermission() async { permission = await center.notificationSettings().authorizationStatus }
    func enable() async {
        do { _ = try await center.requestAuthorization(options: [.alert, .sound, .badge]); error = "" } catch { self.error = error.localizedDescription }
        await checkPermission()
    }
    /// Local schedules need neither APNs nor a paid developer membership.
    func reconcile(_ tasks: [TaskRecord], userID: String?, timeZone: String) async {
        latest = (tasks, userID, timeZone)
        guard !reconciling else { return }
        reconciling = true
        defer { reconciling = false }
        while let request = latest {
            latest = nil
            await apply(request.0, userID: request.1, timeZone: request.2)
        }
    }
    private func apply(_ tasks: [TaskRecord], userID: String?, timeZone: String) async {
        await checkPermission()
        let old = await center.pendingNotificationRequests()
        guard let userID, permission == .authorized || permission == .provisional else {
            center.removePendingNotificationRequests(withIdentifiers: old.filter { $0.identifier.hasPrefix("matrica.") && $0.identifier != "matrica.test" }.map(\.identifier))
            scheduled = 0; total = 0; return
        }
        let existing = old.map { request -> ReminderSpec in
            let trigger = request.trigger as? UNCalendarNotificationTrigger
            let components = trigger?.dateComponents ?? DateComponents()
            var calendar = Calendar(identifier: .gregorian); calendar.timeZone = components.timeZone ?? .current
            return ReminderSpec(id: request.identifier, taskID: request.content.userInfo["taskId"] as? String ?? "", title: request.content.title, body: request.content.body, when: calendar.date(from: components) ?? .distantPast, timeZone: calendar.timeZone.identifier)
        }
        let plan = ReminderPlan.make(tasks: tasks, userID: userID, timeZone: timeZone, existing: existing)
        center.removePendingNotificationRequests(withIdentifiers: plan.cancel)
        scheduled = plan.scheduled; total = plan.total; error = ""
        for spec in plan.add {
            var cal = Calendar(identifier: .gregorian); cal.timeZone = TimeZone(identifier: spec.timeZone) ?? .current
            var components = cal.dateComponents([.year, .month, .day, .hour, .minute], from: spec.when); components.timeZone = cal.timeZone
            let content = UNMutableNotificationContent(); content.title = spec.title; content.body = spec.body; content.sound = .default; content.userInfo = ["taskId": spec.taskID]
            do { try await center.add(UNNotificationRequest(identifier: spec.id, content: content, trigger: UNCalendarNotificationTrigger(dateMatching: components, repeats: false))) }
            catch { self.error = error.localizedDescription; scheduled -= 1 }
        }
    }

    func test() async {
        let content = UNMutableNotificationContent(); content.title = "Матрица"; content.body = "Проверка системного напоминания. Интернет не нужен."; content.sound = .default
        do { try await center.add(UNNotificationRequest(identifier: "matrica.test", content: content, trigger: UNTimeIntervalNotificationTrigger(timeInterval: 5, repeats: false))); error = "" } catch { self.error = error.localizedDescription }
    }
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions { [.banner, .sound, .list] }
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let id = response.notification.request.content.userInfo["taskId"] as? String
        await MainActor.run { self.openedTask = id }
    }
}
