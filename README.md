# Desktop Assistant Bot – Phase 1, Phase 2 & Phase 3

An offline-first personal Windows desktop productivity and workflow automation assistant built with **Electron**, **TypeScript**, **Node.js**, and **SQLite (`better-sqlite3`)**.

---

## 1. Overview

**Desktop Assistant Bot** runs quietly in the Windows background and resides in the **Windows System Tray**. Press **`Ctrl + Shift + Space`** from anywhere in Windows to summon or hide the assistant dashboard instantly.

### Core Principles & Restrictions
- **100% Offline-First**: Works completely without an Internet connection at runtime.
- **No AI / No Cloud**: Zero integration with ChatGPT, Gemini, or any external cloud APIs.
- **No Accounts or Telemetry**: No authentication, no remote databases, no analytics or tracking.
- **Local SQLite Persistence**: All settings, tasks, notes, reminders, lunar reminders, automation workflows, execution logs, and action logs are persisted locally in SQLite (`%APPDATA%\desktop-assistant-bot\desktop-assistant-bot.db`).

---

## 2. Technology Stack

| Component | Technology |
|---|---|
| Desktop Framework | Electron (`33.3.1`) |
| Language | TypeScript (`^5.7.2`) |
| Runtime | Node.js |
| Frontend UI | Semantic HTML5, Modern CSS3 (Dark & Light Fluent Themes), TypeScript |
| Local Database | SQLite (`better-sqlite3` `^11.8.1`, WAL Mode) |
| Windows Integration | Electron `shell`, `globalShortcut`, `Tray`, `Notification`, Login Items API, Node `fs.watch`, `child_process.spawn` (`shell: false`), and native Windows `user32.dll` (`LockWorkStation`) |
| Packaging & Installer | `electron-builder` (`^25.1.8`) – Windows NSIS `.exe` installer |

---

## 3. Project Structure

```text
desktop-assistant-bot/
├── electron/
│   ├── main.ts                          # Electron Main Process lifecycle, BrowserWindow, IPC & 33 Smoke Tests
│   ├── preload.ts                       # Context-isolated preload script exposing window.assistantApi
│   ├── tray.ts                          # Windows System Tray icon, tooltip, context menu & double-click
│   ├── shortcut.ts                      # Global hotkey registration, validation & conflict rollback
│   ├── windows.ts                       # Windows directories, Notepad launcher, LockWorkStation & login items
│   ├── storage.ts                       # Local SQLite database service with versioned migrations (v1..v3)
│   ├── services/
│   │   ├── lunar-calendar.ts            # Hồ Ngọc Đức Vietnamese Lunar Calendar engine (UTC+7)
│   │   └── reminder-scheduler.ts        # Background reminder scheduler & Electron Notification service
│   └── automation/                      # Phase 3 Auto Task Bot & Workflow Automation Engine
│       ├── types.ts                     # Trigger, Condition, Action, Policy & Log TypeScript interfaces
│       ├── security/path-validator.ts   # Local path traversal guard, Trusted Exe allowlist & Safe URL validator
│       ├── conditions/condition-engine.ts # AND/OR group evaluator for Time, File, Todo & Workflow rules
│       ├── actions/action-registry.ts   # 20 Action executors (App, File, Notification, Todo, Notes, Reminder, Flow)
│       ├── triggers/trigger-manager.ts  # Schedule, Global Hotkey, Startup & File Watcher triggers
│       └── engine/workflow-engine.ts    # Sequential execution, retry, timeout, cancellation & JSON import/export
├── src/
│   ├── index.html                       # Main application shell with strict Content Security Policy
│   ├── renderer.ts                      # Renderer coordinator (8 navigation views, modals, IPC events)
│   ├── types.ts                         # Shared TypeScript interfaces
│   ├── styles/
│   │   └── main.css                     # Dark Mode & Light Mode Fluent desktop styling
│   ├── components/
│   │   ├── sidebar.ts                   # Sidebar navigation & tray controls
│   │   ├── toast.ts                     # Toast notification manager
│   │   └── confirm-dialog.ts            # Confirmation modal for destructive actions
│   ├── pages/
│   │   ├── dashboard/index.ts           # Dashboard view (status, productivity summary, quick actions)
│   │   ├── launcher/index.ts            # Quick Launcher view with category & search filters
│   │   ├── todo/index.ts                # Module 1: Todo List (CRUD, status, priority, categories, stats)
│   │   ├── notes/index.ts               # Module 2: Quick Notes (autosave, pin, colors, search, copy)
│   │   ├── reminders/index.ts           # Module 3: Solar & Lunar Reminders + Notification History
│   │   ├── calendar/index.ts            # Module 4: Vietnamese Lunar/Solar Calendar & Converter
│   │   ├── automation/index.ts          # Phase 3: Auto Task Bot (Dashboard, My Automations, Builder, History, Settings)
│   │   └── settings/index.ts            # Settings view (theme, hotkey recorder, startup, live SQLite view)
│   ├── services/
│   │   └── ipc.ts                       # Renderer IPC client wrapper
│   └── utils/
│       └── lunar-calendar.ts            # Renderer Vietnamese Lunar Calendar utility
├── database/
│   └── migrations/
│       ├── 001_initial_schema.sql              # Phase 1 settings schema
│       ├── 002_phase2_productivity_schema.sql  # Phase 2 tasks, categories, notes, reminders, lunar_reminders
│       └── 003_phase3_automation_schema.sql    # Phase 3 automations, executions, action_logs, automation_settings
├── assets/
│   └── icons/
│       ├── icon.ico                     # Multi-resolution Windows icon (256x256, 64x64, 32x32, 16x16)
│       ├── icon.png                     # 256x256 PNG application icon
│       └── tray.png                     # 32x32 PNG system tray icon
├── scripts/
│   ├── ensure-native.js                 # Verifies Electron & better-sqlite3 native binaries
│   ├── generate-icons.js                # Generates application & tray icons
│   └── copy-assets.js                   # Copies HTML & CSS assets into dist/src/
└── README.md
```

---

## 4. Phase 3 – Auto Task Bot & Workflow Automation Engine

The **Auto Task Bot** module allows you to build, schedule, trigger, and monitor multi-step local workflows on Windows:

$$\text{Trigger} \longrightarrow \text{Conditions (AND / OR)} \longrightarrow \text{Sequential Actions} \longrightarrow \text{Execution \& Step Logs}$$

### 4.1 Supported Triggers
1. **Schedule Trigger**:
   - Frequencies: `once`, `daily`, `weekly` (selected weekdays `Sun..Sat`), `monthly` (day of month `1..31`), `yearly` (month + day).
   - Supports `startDate`, optional `endDate`, and configurable **Missed Schedule Policy** (`run_once`, `skip`, or `ask_user`) when the application starts after being closed.
2. **Global Hotkey Trigger**:
   - Registers custom global shortcuts (e.g. `CommandOrControl+Alt+T`).
   - Automatically prevents conflicts with the main Assistant toggle shortcut (`Ctrl + Shift + Space`) and other enabled workflows.
3. **Application Startup Trigger**:
   - Runs automatically when Desktop Assistant Bot starts, with configurable `delaySeconds` and `oncePerSession` guard.
4. **File / Folder Watcher Trigger**:
   - Monitors local folders using `fs.watch` with snapshot diffing to detect `created`, `changed`, `deleted`, and `renamed` events.
   - Supports wildcard `fileNamePattern` (e.g. `*.pdf`), `extensionFilter` (e.g. `.pdf,.txt`), and configurable debounce (`debounceMs`).

### 4.2 Supported Condition Rules (`AND` / `OR`)
- **Time Conditions**: `time_hour`, `time_weekday`, `time_date`, `time_date_range`
- **File Conditions**: `file_exists`, `file_not_exists`, `file_extension`, `file_size`
- **Todo Conditions**: `todo_incomplete_count`, `todo_overdue_count`, `todo_completed`
- **Workflow Conditions**: `workflow_enabled`, `workflow_last_status`, `workflow_is_running`
- **Operators**: `equals`, `not_equals`, `greater_than`, `less_than`, `contains`, `exists`

### 4.3 Supported Actions (20 Action Types)
- **Application Actions**: `open_application` (validated against the **Trusted Application Paths** allowlist), `open_folder`, `open_url` (`http:` / `https:` only).
- **Notification Action**: `show_notification` (Windows desktop notification).
- **Todo List Actions**: `create_todo`, `update_todo_status`, `complete_todo`.
- **Quick Notes Actions**: `create_note`, `update_note`, `pin_note`.
- **Reminder Actions**: `create_reminder`, `enable_reminder`, `disable_reminder`.
- **File System Actions**: `copy_file`, `move_file`, `rename_file`, `create_folder` (with explicit `overwrite` protection so files are never overwritten silently).
- **Flow Control Actions**: `delay` (abortable wait), `stop_workflow` (clean early exit), `if_else` (conditional branching).

### 4.4 Example Workflows
1. **Morning Productivity Routine** (*Schedule: Weekdays at 08:00*):
   - Condition: `todo_incomplete_count < 50`
   - Action 1: Create high-priority Todo `"Review daily priorities & calendar"` due in 4 hours.
   - Action 2: Create pinned Quick Note `"Daily Scratchpad"`.
   - Action 3: Show desktop notification `"Good Morning! Daily task and scratchpad note are ready."`
2. **Quick Focus Snapshot** (*Hotkey: `Ctrl + Alt + T`*):
   - Action 1: Create urgent Todo `"Quick Follow-up Item"` (`in_progress`).
   - Action 2: Create Reminder `"Check Quick Follow-up Item"` 30 minutes from trigger time.
3. **Downloads Document Organizer** (*File Watcher on `C:\Users\<User>\Downloads` for `.pdf` creation*):
   - Condition: `file_exists`
   - Action 1: Create folder `C:\Users\<User>\Documents\PDF_Inbox`.
   - Action 2: Copy/Move file to `PDF_Inbox` (with `overwrite: false`).
   - Action 3: Show desktop notification.

---

## 5. Installation, Execution & Packaging

### Install Dependencies
```powershell
npm install
```

### Run in Development Mode
```powershell
npm run start
```

### Run Automated Smoke & Regression Test Suite (33 Test Suites)
```powershell
npm run test:smoke
```

### Build Windows NSIS Installer (`.exe`)
```powershell
npm run dist
```
Output artifacts are generated in `release/`:
- `release/Desktop Assistant Bot Setup 1.0.0.exe` (Windows NSIS installer)
- `release/win-unpacked/Desktop Assistant Bot.exe` (Unpacked production executable)
