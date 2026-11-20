import SwiftUI

struct TaskEditor: View {
    let original: TaskRecord
    let isNew: Bool
    @EnvironmentObject private var store: TaskStore
    @Environment(\.dismiss) private var dismiss
    @State private var title: String
    @State private var note: String
    @State private var hasDate: Bool
    @State private var date: Date
    @State private var hasTime: Bool
    @State private var time: Date
    @State private var quadrant: Int
    @State private var folder: String
    @State private var tags: String
    @State private var flagged: Bool
    @State private var subtasks: [JSONValue]
    @State private var frequency: String
    @State private var interval: Int
    @State private var hasEnd: Bool
    @State private var end: Date
    @State private var validation = ""
    init(original: TaskRecord, isNew: Bool) {
        self.original = original; self.isNew = isNew
        _title = State(initialValue: original.title); _note = State(initialValue: original.note)
        _hasDate = State(initialValue: !original.date.isEmpty); _date = State(initialValue: Self.parseLocal(original.date) ?? Date())
        _hasTime = State(initialValue: !original.time.isEmpty)
        let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "HH:mm"
        _time = State(initialValue: f.date(from: original.time) ?? Date())
        _quadrant = State(initialValue: original.quadrant); _folder = State(initialValue: original.folderID)
        _tags = State(initialValue: original.tags.map { "#" + $0 }.joined(separator: " ")); _flagged = State(initialValue: original.flagged); _subtasks = State(initialValue: original.subtasks)
        _frequency = State(initialValue: original.repeating["freq"]?.string ?? ""); _interval = State(initialValue: max(1, Int(original.repeating["interval"]?.number ?? 1)))
        let until = original.repeating["until"]?.string ?? ""; _hasEnd = State(initialValue: !until.isEmpty); _end = State(initialValue: Self.parseLocal(until) ?? Date())
    }
    var body: some View {
        NavigationStack {
            Form {
                Section { TextField("Название", text: $title); if !original.isFolder { TextField("Описание", text: $note, axis: .vertical).lineLimit(3...8) } }
                if !original.isFolder {
                    Section("Планирование") {
                        Toggle("Дата", isOn: $hasDate)
                        if hasDate {
                            DatePicker("День", selection: $date, displayedComponents: .date)
                            Picker("Квадрант", selection: $quadrant) { Text("Срочно и важно").tag(0); Text("Важно, не срочно").tag(1); Text("Срочно, не важно").tag(2); Text("Не срочно, не важно").tag(3) }
                            Toggle("Напомнить", isOn: $hasTime)
                            if hasTime { DatePicker("Время", selection: $time, displayedComponents: .hourAndMinute); Text("Часовой пояс: \(store.snapshot.timeZone). Разрешите системные уведомления через кнопку с колокольчиком.").font(.caption).foregroundStyle(.secondary) }
                        }
                        Picker("Папка", selection: $folder) {
                            Text("Без папки").tag("")
                            ForEach(store.folders) { f in Text(f.title).tag(f.id) }
                            if !folder.isEmpty && !store.folders.contains(where: { $0.id == folder }) { Text("Недоступная папка").tag(folder) }
                        }
                    }
                    Section("Дополнительно") { TextField("Теги: #работа #дом", text: $tags); Toggle("С флажком", isOn: $flagged) }
                    Section("Подзадачи") {
                        ForEach(subtasks.indices, id: \.self) { i in
                            HStack {
                                Button { var value = subtasks[i].object; value["done"] = .bool(!(value["done"]?.bool ?? false)); subtasks[i] = .object(value) } label: { Image(systemName: subtasks[i].object["done"]?.bool == true ? "checkmark.circle.fill" : "circle") }.buttonStyle(.plain)
                                TextField("Название подзадачи", text: Binding(get: { subtasks[i].object["title"]?.string ?? "" }, set: { text in var value = subtasks[i].object; value["title"] = .string(text); subtasks[i] = .object(value) }))
                                Button { subtasks.remove(at: i) } label: { Image(systemName: "minus.circle") }.buttonStyle(.plain).accessibilityLabel("Убрать подзадачу")
                            }
                        }
                        Button("Добавить подзадачу") { subtasks.append(.object(["id": .string(UUID().uuidString.lowercased()), "title": .string(""), "done": .bool(false)])) }
                    }
                    Section("Повторение") {
                        Picker("Повторять", selection: $frequency) { Text("Никогда").tag(""); Text("По дням").tag("day"); Text("По будням").tag("weekdays"); Text("По неделям").tag("week"); Text("По месяцам").tag("month"); Text("По годам").tag("year") }
                        if !frequency.isEmpty { if frequency != "weekdays" { Stepper("Интервал: \(interval)", value: $interval, in: 1...365) }; Toggle("Дата окончания", isOn: $hasEnd); if hasEnd { DatePicker("Повторять до", selection: $end, displayedComponents: .date) }; Text("Следующая задача появится после выполнения этой.").font(.caption).foregroundStyle(.secondary) }
                    }
                }
                if !validation.isEmpty { Text(validation).foregroundStyle(.red) }
            }.formStyle(.grouped)
                .navigationTitle(original.isFolder ? "Папка" : isNew ? "Новая задача" : "Задача")
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Отмена") { dismiss() } }; ToolbarItem(placement: .confirmationAction) { Button("Сохранить") { save() }.disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) } }
        }.frame(minWidth: 320, minHeight: 480)
    }
    private func save() {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.count <= 300 else { validation = "Название должно содержать от 1 до 300 символов"; return }
        if !frequency.isEmpty && !hasDate { validation = "Для повторения нужна дата"; return }
        if hasEnd && !frequency.isEmpty && DateTools.day(end) < DateTools.day(date) { validation = "Окончание повторения раньше даты задачи"; return }
        var t = original; t.title = trimmed
        if !t.isFolder {
            t.note = note; t.date = hasDate ? DateTools.day(date) : ""; t.quadrant = quadrant
            let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "HH:mm"; t.time = hasDate && hasTime ? f.string(from: time) : ""
            t.folderID = folder; t.flagged = flagged
            var seen: Set<String> = []
            t.tags = tags.components(separatedBy: CharacterSet.whitespacesAndNewlines.union(CharacterSet(charactersIn: ",;"))).map { $0.trimmingCharacters(in: CharacterSet(charactersIn: "#")).precomposedStringWithCompatibilityMapping.lowercased() }.filter { !$0.isEmpty && $0.range(of: "^[\\p{L}\\p{N}_-]{1,50}$", options: .regularExpression) != nil && seen.insert($0).inserted }.prefix(30).map { $0 }
            t.subtasks = subtasks.filter { !($0.object["title"]?.string.trimmingCharacters(in: .whitespacesAndNewlines) ?? "").isEmpty }
            if frequency.isEmpty { t.setMeta("repeat", nil) }
            else { var rule = original.repeating; if rule["freq"]?.string != frequency { rule = [:] }; rule["freq"] = .string(frequency); rule["interval"] = .number(Double(interval)); rule["until"] = .string(hasEnd ? DateTools.day(end) : ""); t.setMeta("repeat", .object(rule)) }
        }
        store.save(t, original: isNew ? nil : original); dismiss()
    }
    private static func parseLocal(_ day: String) -> Date? { let f = DateFormatter(); f.calendar = Calendar(identifier: .gregorian); f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "yyyy-MM-dd"; return f.date(from: day) }
}
