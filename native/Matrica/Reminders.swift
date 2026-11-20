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
        center.removePendingNotificationRequests(withIdentifiers: old.filter { $0.identifier.hasPrefix("matrica.") }.map(\.identifier))
        scheduled = 0; total = 0; error = ""
        guard let userID, permission == .authorized || permission == .provisional else { return }
        let zone = TimeZone(identifier: timeZone) ?? .current
        let upcoming = tasks.compactMap { task -> (TaskRecord, Date)? in guard task.userID == userID, let when = DateTools.reminder(task, zone: zone), when > Date() else { return nil }; return (task, when) }.sorted { $0.1 < $1.1 }
        total = upcoming.count
        // Keep below the platform's pending-request budget; refill whenever the app opens/syncs.
        for (task, when) in upcoming.prefix(60) {
            var cal = Calendar(identifier: .gregorian); cal.timeZone = zone
            var components = cal.dateComponents([.year, .month, .day, .hour, .minute], from: when); components.timeZone = zone
            let content = UNMutableNotificationContent(); content.title = task.title; content.body = task.note.isEmpty ? "Пора выполнить задачу" : task.note; content.sound = .default; content.userInfo = ["taskId": task.id]
            let id = "matrica.\(userID).\(task.id)"
            do {
                try await center.add(UNNotificationRequest(identifier: id, content: content, trigger: UNCalendarNotificationTrigger(dateMatching: components, repeats: false)))
                scheduled += 1
            } catch { self.error = error.localizedDescription }
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
