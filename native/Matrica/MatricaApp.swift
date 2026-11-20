import SwiftUI

@main struct MatricaApp: App {
    @StateObject private var store = TaskStore()
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage("matrica.native.theme") private var theme = "system"
    var body: some Scene {
        WindowGroup {
            RootView().environmentObject(store).environmentObject(store.reminders)
                .preferredColorScheme(theme == "dark" ? .dark : theme == "light" ? .light : nil)
                .task {
                    while !Task.isCancelled {
                        if scenePhase == .active { await store.sync() }
                        do { try await Task.sleep(nanoseconds: 15_000_000_000) } catch { return }
                    }
                }
                .onChange(of: scenePhase) { _, phase in if phase == .active { Task { await store.sync(); store.refreshReminders() } } }
        }
    }
}

enum PlannerSection: String, CaseIterable, Identifiable {
    case day = "День", week = "Неделя", inbox = "Входящие", overdue = "Хвосты", archive = "Архив"
    var id: String { rawValue }
    var symbol: String { switch self { case .day: return "square.grid.2x2"; case .week: return "list.bullet"; case .inbox: return "tray"; case .overdue: return "clock"; case .archive: return "archivebox" } }
}
struct RootView: View {
    @EnvironmentObject private var store: TaskStore
    @EnvironmentObject private var reminders: LocalReminders
    @State private var section: PlannerSection? = .day
    @State private var compactColumn: NavigationSplitViewColumn = .detail
    @State private var selected = Date()
    @State private var query = ""
    @State private var folder = "all"
    @State private var editing: TaskRecord?
    @State private var showMonths = false
    @State private var showSettings = false
    @State private var showDeleted = false
    @State private var expandedDays: Set<String> = []
    @State private var showLogin = false
    @State private var newFolder = false
    @State private var folderName = ""
    @AppStorage("matrica.native.calendar.day") private var dayCalendar = false
    @AppStorage("matrica.native.calendar.week") private var weekCalendar = false
    private let titles = ["Срочно и важно", "Важно, не срочно", "Срочно, не важно", "Не срочно, не важно"]
    private let colors: [Color] = [.red, .green, .orange, .blue]
    private var selectedDay: String { DateTools.day(selected) }
    private var current: PlannerSection { section ?? .day }
    private var calendarVisible: Bool { current == .day ? dayCalendar : weekCalendar }
    private var active: [TaskRecord] { store.tasks.filter { !$0.isFolder && !$0.deleted && (!$0.done || store.pendingCompletion.contains($0.id)) } }
    private var searchResults: [TaskRecord] {
        active.filter { t in let haystack = ([t.title, t.note] + t.tags + t.subtasks.map { $0.object["title"]?.string ?? "" }).joined(separator: " "); return query.split(separator: " ").allSatisfy { haystack.localizedCaseInsensitiveContains(String($0)) } }
    }
    var body: some View {
        Group {
            if store.session == nil { LoginView() }
            else {
                NavigationSplitView(preferredCompactColumn: $compactColumn) {
                    List(selection: $section) {
                        Section("Матрица") { ForEach(PlannerSection.allCases) { s in Label(s.rawValue, systemImage: s.symbol).tag(s) } }
                        Section("Месяцы") {
                            ForEach(-3..<13, id: \.self) { offset in
                                let month = Calendar.current.date(byAdding: .month, value: offset, to: Date())!
                                Button(month.formatted(.dateTime.month(.wide).year())) { chooseMonth(month) }
                            }
                        }
                    }.navigationTitle("Матрица").navigationSplitViewColumnWidth(min: 190, ideal: 230)
                } detail: {
                    NavigationStack {
                        VStack(spacing: 0) {
                            if store.needsLogin { Button("Войти снова для синхронизации") { showLogin = true }.padding(8) }
                            if current == .day || current == .week {
                                HStack {
                                    Button { showMonths = true } label: { Label(selected.formatted(.dateTime.month(.wide).year()), systemImage: "chevron.down") }
                                    Spacer()
                                    Button("Сегодня") { selected = Date() }
                                }.padding(.horizontal).padding(.vertical, 8)
                                if calendarVisible { DatePicker("Дата", selection: $selected, displayedComponents: .date).datePickerStyle(.graphical).padding(.horizontal).accessibilityLabel("Календарь") }
                            }
                            planner
                            HStack { Text(store.status).font(.caption).foregroundStyle(.secondary); Spacer(); if store.pendingCount > 0 { Text("Ожидают отправки: \(store.pendingCount)").font(.caption) } }.padding(.horizontal).padding(.vertical, 6)
                        }
                        .navigationTitle(query.isEmpty ? current.rawValue : "Поиск")
                        .searchable(text: $query, prompt: "Задачи, описания, теги")
                        .toolbar {
                            ToolbarItemGroup(placement: .primaryAction) {
                                if current == .day || current == .week {
                                    Button { if current == .day { dayCalendar.toggle() } else { weekCalendar.toggle() } } label: { Image(systemName: "calendar") }.help(calendarVisible ? "Свернуть календарь" : "Показать календарь")
                                }
                                Button { showSettings = true } label: { Image(systemName: "bell") }.help("Уведомления и настройки")
                                Button { Task { await store.sync() } } label: { Image(systemName: "arrow.triangle.2.circlepath") }.disabled(store.syncing).help("Синхронизировать")
                                Button { addTask() } label: { Image(systemName: "plus") }.help("Добавить задачу").keyboardShortcut("n", modifiers: .command)
                            }
                        }
                    }
                }
                .onChange(of: reminders.openedTask) { _, id in
                    guard let id, let t = store.tasks.first(where: { $0.id == id }) else { return }
                    if t.deleted || t.done { section = .archive; showDeleted = t.deleted } else if t.date.isEmpty { section = .inbox; folder = "all" } else { section = .day; selected = localDate(t.date) }
                    compactColumn = .detail; query = ""; reminders.openedTask = nil
                }
            }
        }
        .sheet(item: $editing) { task in TaskEditor(original: task, isNew: !store.tasks.contains(where: { $0.id == task.id })) }
        .sheet(isPresented: $showMonths) { MonthPicker(selected: $selected, onChoose: { if current != .week { section = .day }; compactColumn = .detail; showMonths = false }) }
        .sheet(isPresented: $showSettings) { NativeSettings() }
        .sheet(isPresented: $showLogin) { LoginView().frame(minWidth: 320, minHeight: 400).onChange(of: store.needsLogin) { _, needed in if !needed { showLogin = false } } }
        .alert("Матрица", isPresented: Binding(get: { store.error != nil }, set: { if !$0 { store.error = nil } })) { Button("Понятно") { store.error = nil } } message: { Text(store.error ?? "") }
        .alert("Новая папка", isPresented: $newFolder) { TextField("Название", text: $folderName); Button("Создать") { guard let id = store.session?.user.id, !folderName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }; var t = TaskRecord.new(userID: id, folder: true); t.title = folderName.trimmingCharacters(in: .whitespacesAndNewlines); store.save(t, original: nil); folderName = "" }; Button("Отмена", role: .cancel) {} }
    }
    @ViewBuilder private var planner: some View {
        if !query.isEmpty { taskList(searchResults) }
        else if current == .day { ScrollView { VStack(alignment: .leading) { Text(selected.formatted(date: .complete, time: .omitted)).font(.headline).padding(.horizontal); quadrants(selectedDay) }.padding(.vertical) }.refreshable { await store.sync() } }
        else if current == .week {
            ScrollView { VStack(spacing: 12) {
                HStack { Button("Открыть все дни") { expandedDays = Set(feedDates) }; Button("Свернуть все дни") { expandedDays = [] } }.buttonStyle(.bordered)
                ForEach(feedDates, id: \.self) { day in
                    DisclosureGroup(isExpanded: Binding(get: { expandedDays.contains(day) }, set: { if $0 { expandedDays.insert(day) } else { expandedDays.remove(day) } })) { quadrants(day) } label: { Text(localDate(day).formatted(date: .complete, time: .omitted)) }.padding().background(.quaternary.opacity(0.3), in: RoundedRectangle(cornerRadius: 18))
                }
            }.padding() }.refreshable { await store.sync() }
        } else if current == .inbox {
            VStack {
                ScrollView(.horizontal, showsIndicators: false) { HStack {
                    Button("Все") { folder = "all" }.tint(folder == "all" ? .accentColor : .secondary)
                    Button("Без папки") { folder = "" }.tint(folder.isEmpty ? .accentColor : .secondary)
                    ForEach(store.folders) { f in Button(f.title) { folder = f.id }.tint(folder == f.id ? .accentColor : .secondary).contextMenu { Button("Переименовать") { editing = f } } }
                    Button("＋ Папка") { newFolder = true }
                }.buttonStyle(.bordered).padding(.horizontal) }
                taskList(active.filter { $0.date.isEmpty && (folder == "all" || $0.folderID == folder) })
            }
        } else if current == .overdue { taskList(active.filter { !$0.date.isEmpty && $0.date < DateTools.day(Date()) }.sorted { $0.date < $1.date }) }
        else { VStack { Picker("Архив", selection: $showDeleted) { Text("Выполненные").tag(false); Text("Удалённые").tag(true) }.pickerStyle(.segmented).padding(.horizontal); taskList(store.tasks.filter { !$0.isFolder && (showDeleted ? $0.deleted : $0.done && !$0.deleted && !store.pendingCompletion.contains($0.id)) }.sorted { $0.completedAt > $1.completedAt }) } }
    }
    private var feedDates: [String] { (0..<21).map { DateTools.day(Calendar.current.date(byAdding: .day, value: $0, to: selected)!) } }
    private func quadrants(_ day: String) -> some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 300), alignment: .top)], alignment: .leading, spacing: 14) {
            ForEach(0..<4, id: \.self) { q in
                let items = active.filter { $0.date == day && $0.quadrant == q }.sorted { $0.rank < $1.rank }
                VStack(alignment: .leading, spacing: 12) {
                    HStack { Text(titles[q]).font(.headline); Text("\(items.count)").foregroundStyle(.secondary); Spacer(); Button { addTask(date: day, quadrant: q) } label: { Image(systemName: "plus") }.buttonStyle(.plain) }.foregroundStyle(colors[q])
                    ForEach(items) { task in taskRow(task) }
                    if items.isEmpty { Button("Добавить задачу") { addTask(date: day, quadrant: q) }.font(.subheadline).foregroundStyle(.secondary).padding(.vertical, 12) }
                }.padding().frame(maxWidth: .infinity, minHeight: 140, alignment: .topLeading).background(colors[q].opacity(0.09), in: RoundedRectangle(cornerRadius: 20))
                .dropDestination(for: String.self) { ids, _ in for id in ids { store.move(id, date: day, quadrant: q) }; return !ids.isEmpty }
            }
        }.padding(.horizontal)
    }
    private func taskList(_ tasks: [TaskRecord]) -> some View {
        List {
            if tasks.isEmpty { ContentUnavailableView("Пока нет задач", systemImage: "checkmark.circle", description: Text("Нажмите ＋, чтобы добавить задачу")) }
            ForEach(tasks) { task in taskRow(task).swipeActions(edge: .leading) { Button(task.done ? "Вернуть" : "Выполнить") { if task.deleted { store.restore(task.id) } else { store.toggle(task.id) } }.tint(.green) }.swipeActions { if !task.deleted { Button("В корзину", role: .destructive) { store.trash(task.id) } } } }
        }.refreshable { await store.sync() }
    }
    private func taskRow(_ task: TaskRecord) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Button { if task.deleted { store.restore(task.id) } else { store.toggle(task.id) } } label: { Image(systemName: task.done ? "checkmark.circle.fill" : "circle").font(.title3).foregroundStyle(task.done ? Color.accentColor : .secondary) }.buttonStyle(.plain).accessibilityLabel(task.done ? "Вернуть задачу" : "Выполнить задачу")
            VStack(alignment: .leading, spacing: 4) {
                Button { editing = task } label: { Text(task.title).strikethrough(task.done).foregroundStyle(.primary).multilineTextAlignment(.leading).frame(maxWidth: .infinity, alignment: .leading) }.buttonStyle(.plain)
                if !task.note.isEmpty { Text(task.note).font(.subheadline).foregroundStyle(.secondary).lineLimit(3) }
                if !task.tags.isEmpty { Text(task.tags.map { "#" + $0 }.joined(separator: " ")).font(.caption).foregroundStyle(.blue) }
                if task.done, !task.completedAt.isEmpty { Text("Завершено: " + completionLabel(task.completedAt)).font(.caption).foregroundStyle(.secondary) }
                else if !task.time.isEmpty { Label(task.time, systemImage: "bell").font(.caption).foregroundStyle(.secondary) }
                if !task.subtasks.isEmpty { Text("Подзадачи: \(task.subtasks.filter { $0.object["done"]?.bool == true }.count) из \(task.subtasks.count)").font(.caption).foregroundStyle(.secondary) }
            }
            if task.flagged { Image(systemName: "flag.fill").foregroundStyle(.orange) }
            Menu { taskActions(task) } label: { Image(systemName: "ellipsis") }.fixedSize().accessibilityLabel("Действия с задачей")
        }.padding(.vertical, 5).draggable(task.id).contextMenu { taskActions(task) }
    }
    @ViewBuilder private func taskActions(_ task: TaskRecord) -> some View {
        if task.deleted { Button("Восстановить") { store.restore(task.id) } }
        else {
            Button("Изменить") { editing = task }
            Button("Создать копию") { store.duplicate(task.id) }
            if !task.done { ForEach([15, 30, 60], id: \.self) { minutes in Button("Напомнить через \(minutes) мин") { store.snooze(task.id, minutes: minutes) } } }
            Button("В корзину", role: .destructive) { store.trash(task.id) }
        }
    }
    private func addTask(date: String? = nil, quadrant: Int = 1) { guard let id = store.session?.user.id else { return }; var task = TaskRecord.new(userID: id, date: date ?? (current == .inbox ? "" : selectedDay), quadrant: quadrant); if current == .inbox && folder != "all" { task.folderID = folder }; editing = task }
    private func chooseMonth(_ month: Date) { let parts = Calendar.current.dateComponents([.year, .month], from: month); selected = Calendar.current.date(from: parts)!; section = .day; compactColumn = .detail; query = "" }
    private func localDate(_ day: String) -> Date { let parts = day.split(separator: "-").compactMap { Int($0) }; guard parts.count == 3 else { return Date() }; return Calendar.current.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: 12)) ?? Date() }
    private func completionLabel(_ value: String) -> String { let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; let d = f.date(from: value) ?? ISO8601DateFormatter().date(from: value); return d?.formatted(date: .abbreviated, time: .shortened) ?? value }
}

struct MonthPicker: View {
    @Binding var selected: Date
    var onChoose: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var year = Calendar.current.component(.year, from: Date())
    var body: some View {
        NavigationStack {
            List {
                HStack { Button { year -= 1 } label: { Image(systemName: "chevron.left") }; Spacer(); Text(String(year)).font(.headline); Spacer(); Button { year += 1 } label: { Image(systemName: "chevron.right") } }.buttonStyle(.borderless)
                ForEach(1...12, id: \.self) { month in
                    let date = Calendar.current.date(from: DateComponents(year: year, month: month, day: 1, hour: 12))!
                    Button { selected = date; onChoose() } label: { HStack { Text(date.formatted(.dateTime.month(.wide))); Spacer(); if Calendar.current.isDate(date, equalTo: selected, toGranularity: .month) { Image(systemName: "checkmark") } } }
                }
            }.navigationTitle("Месяцы").toolbar { Button("Готово") { dismiss() } }
        }.frame(minWidth: 300, minHeight: 420).onAppear { year = Calendar.current.component(.year, from: selected) }
    }
}

struct LoginView: View {
    @EnvironmentObject private var store: TaskStore
    @State private var email = ""
    @State private var password = ""
    var body: some View {
        VStack(spacing: 20) {
            Image(systemName: "square.grid.2x2.fill").font(.system(size: 44)).foregroundStyle(.blue)
            Text("Матрица").font(.largeTitle.bold())
            Text("Войдите в существующий аккаунт. Задачи из веб-версии появятся здесь.").foregroundStyle(.secondary).multilineTextAlignment(.center)
            TextField("Электронная почта", text: $email).textContentType(.username).textFieldStyle(.roundedBorder)
            SecureField("Пароль", text: $password).textContentType(.password).textFieldStyle(.roundedBorder)
            Button(store.syncing ? "Входим…" : "Войти") { Task { await store.signIn(email: email, password: password); password = "" } }.buttonStyle(.borderedProminent).disabled(email.isEmpty || password.isEmpty || store.syncing).keyboardShortcut(.defaultAction)
            Text("Первый вход требует интернета. Затем задачи доступны без сети.").font(.caption).foregroundStyle(.secondary)
        }.padding(28).frame(maxWidth: 430).frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct NativeSettings: View {
    @EnvironmentObject private var store: TaskStore
    @EnvironmentObject private var reminders: LocalReminders
    @Environment(\.dismiss) private var dismiss
    @AppStorage("matrica.native.theme") private var theme = "system"
    @State private var confirmSignOut = false
    var body: some View {
        NavigationStack {
            Form {
                Section("Уведомления") {
                    Text(reminders.permission == .authorized || reminders.permission == .provisional ? "Системные уведомления разрешены" : "Уведомления не разрешены")
                    Button("Разрешить уведомления") { Task { await reminders.enable(); store.refreshReminders() } }
                    Button("Проверить через 5 секунд") { Task { await reminders.test() } }.disabled(reminders.permission != .authorized && reminders.permission != .provisional)
                    Text("Запланировано: \(reminders.scheduled) из \(reminders.total). Часовой пояс: \(store.snapshot.timeZone)").font(.caption)
                    Text("Уже назначенные напоминания работают без интернета и при закрытом приложении. Разрешите звук и баннеры в системных настройках. Фокусирование может скрывать уведомления.").font(.caption).foregroundStyle(.secondary)
                    Text("Приложение назначает до 60 ближайших напоминаний и обновляет их при открытии. Правки с другого устройства применятся после синхронизации. Если включены уведомления веб-версии, могут приходить два уведомления.").font(.caption).foregroundStyle(.secondary)
                    if !reminders.error.isEmpty { Text(reminders.error).foregroundStyle(.red) }
                }
                Section("Оформление") { Picker("Тема", selection: $theme) { Text("Как в системе").tag("system"); Text("Светлая").tag("light"); Text("Тёмная").tag("dark") } }
                Section("Аккаунт") { Text(store.session?.user.email ?? ""); Text(store.status).font(.caption); if !store.syncError.isEmpty { Text(store.syncError).font(.caption).foregroundStyle(.secondary) }; Button("Синхронизировать") { Task { await store.sync() } }.disabled(store.syncing); Button("Выйти", role: .destructive) { confirmSignOut = true }.disabled(store.syncing) }
                Section { Text("Пробная нативная версия. При бесплатной установке на iPhone подпись действует 7 дней. Локальные задачи сохраняются; перед удалением приложения дождитесь синхронизации.").font(.caption).foregroundStyle(.secondary) }
            }.formStyle(.grouped).navigationTitle("Настройки").toolbar { Button("Готово") { dismiss() } }
            .confirmationDialog("Выйти? Неотправленные изменения останутся на устройстве до следующего входа в этот аккаунт.", isPresented: $confirmSignOut) { Button("Выйти", role: .destructive) { store.signOut(); dismiss() } }
        }.frame(minWidth: 320, minHeight: 480).task { await reminders.checkPermission() }
    }
}
