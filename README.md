# Desktop Assistant Bot – Phase 1

An offline-first personal Windows desktop productivity assistant built with **Electron**, **TypeScript**, **Node.js**, and **SQLite (`better-sqlite3`)**.

---

## 1. Overview

**Desktop Assistant Bot** runs quietly in the Windows background and resides in the **Windows System Tray**. Press **`Ctrl + Shift + Space`** from anywhere in Windows to summon or hide the assistant dashboard instantly.

### Core Principles & Restrictions
- **100% Offline-First**: Works completely without an Internet connection at runtime.
- **No AI / No Cloud**: Zero integration with ChatGPT, Gemini, or any external cloud APIs.
- **No Accounts or Telemetry**: No authentication, no remote databases, no analytics or tracking.
- **Local SQLite Persistence**: All settings are persisted in a local SQLite database (`%APPDATA%\desktop-assistant-bot\desktop-assistant-bot.db`).

---

## 2. Technology Stack

| Component | Technology |
|---|---|
| Desktop Framework | Electron (`^34.2.0`) |
| Language | TypeScript (`^5.7.2`) |
| Runtime | Node.js |
| Frontend UI | Semantic HTML5, Modern CSS3 (Dark & Light Fluent Themes), TypeScript |
| Local Database | SQLite (`better-sqlite3` `^11.8.1`) |
| Windows Integration | Electron `shell`, `globalShortcut`, `Tray`, Login Items API, and native Windows `user32.dll` (`LockWorkStation`) |
| Packaging & Installer | `electron-builder` (`^25.1.8`) – Windows NSIS `.exe` installer |

---

## 3. Project Structure

```text
desktop-assistant-bot/
├── electron/
│   ├── main.ts                # Electron Main Process lifecycle, BrowserWindow & IPC handlers
│   ├── preload.ts             # Context-isolated preload script exposing window.assistantApi
│   ├── tray.ts                # Windows System Tray icon, tooltip, context menu & double-click
│   ├── shortcut.ts            # Global hotkey registration, validation & conflict rollback
│   ├── windows.ts             # Windows directories, Notepad launcher, LockWorkStation & login items
│   └── storage.ts             # Local SQLite database service using better-sqlite3 (WAL mode)
├── src/
│   ├── index.html             # Main application shell with strict Content Security Policy
│   ├── renderer.ts            # Renderer entry point coordinating state, pages, modal & events
│   ├── types.ts               # Shared TypeScript interfaces
│   ├── styles/
│   │   └── main.css           # Dark Mode & Light Mode Fluent desktop styling
│   ├── components/
│   │   ├── sidebar.ts         # Sidebar navigation & tray controls
│   │   └── toast.ts           # Toast notification manager
│   ├── pages/
│   │   ├── dashboard/
│   │   │   └── index.ts       # Dashboard view (status, quick actions, Windows controls)
│   │   ├── launcher/
│   │   │   └── index.ts       # Quick Launcher view with category & search filters
│   │   └── settings/
│   │       └── index.ts       # Settings view (theme, hotkey recorder, startup, live SQLite view)
│   └── services/
│       └── ipc.ts             # Renderer IPC client wrapper
├── database/
│   └── migrations/
│       └── 001_initial_schema.sql
├── assets/
│   └── icons/
│       ├── icon.ico           # Multi-resolution Windows icon (256x256, 64x64, 32x32, 16x16)
│       ├── icon.png           # 256x256 PNG application icon
│       └── tray.png           # 32x32 PNG system tray icon
├── scripts/
│   ├── generate-icons.js      # Generates application & tray icons
│   └── copy-assets.js         # Copies HTML & CSS assets into dist/src/
├── package.json
├── tsconfig.json
├── tsconfig.main.json
├── tsconfig.renderer.json
└── README.md
```

---

## 4. Phase 1 Features

### 4.1 Dashboard
- Displays application name, version (`v1.0.0`), offline readiness badge, and active global hotkey.
- Displays Windows platform architecture, OS release, and system memory metrics.
- Provides 1-click **Quick Actions** and **Windows Controls**.

### 4.2 System Tray Integration
- Runs in the Windows System Tray with a custom icon and dynamic tooltip showing the active hotkey.
- Context menu commands:
  - **Open Assistant**
  - **Hide Assistant**
  - **Exit Application**
- **Double-clicking** the tray icon opens and focuses the assistant.
- Clicking the window close button (`X`) **hides the window to the System Tray** without terminating the application.

### 4.3 Global Hotkey (`Ctrl + Shift + Space`)
- Toggles window visibility from anywhere in Windows:
  - Shows and focuses the window if hidden.
  - Restores and brings the window to the foreground if minimized.
  - Hides the window if currently visible.
- Configurable in **Settings** via an interactive key recorder or manual input.
- Validates accelerators and automatically restores the previous working shortcut if registration fails or conflicts with another application.

### 4.4 Quick Launcher
Opens native Windows user folders and tools safely via whitelisted Main Process targets:
- **Desktop Folder** (`app.getPath('desktop')`)
- **Downloads Folder** (`app.getPath('downloads')`)
- **Documents Folder** (`app.getPath('documents')`)
- **Pictures Folder** (`app.getPath('pictures')`)
- **User Home Directory** (`app.getPath('home')`)
- **Windows Notepad** (`C:\Windows\System32\notepad.exe`)

### 4.5 Windows Controls
- **Lock Workstation**: Invokes native Windows `rundll32.exe user32.dll,LockWorkStation` without shell interpolation.
- **Display Application Information**: Opens a diagnostic modal inspecting Electron/Node/Chromium versions, OS release, user data path, and SQLite database location.
- **Shutdown / Restart**: Intentionally disabled in Phase 1 per specification.

### 4.6 Settings & SQLite Persistence
- **Dark Mode & Light Mode** with instant switching and SQLite persistence.
- **Global Hotkey Configuration** with live key recorder and reset-to-default button.
- **Start with Windows** toggle (`app.setLoginItemSettings` + SQLite persistence).
- **Live SQLite `settings` Table Inspector** displaying persisted rows (`id`, `key`, `value`, `updated_at`).

---

## 5. Security Architecture

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`
- Strict Content Security Policy (`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none';`)
- Preload script (`electron/preload.ts`) exposes only explicitly whitelisted IPC channels via `contextBridge`.
- All IPC arguments are validated in both preload and main processes; arbitrary shell command execution from the renderer is impossible.

---

## 6. Installation & Usage Instructions

### Prerequisites
- Windows 10 or Windows 11 (x64)
- Node.js `v18+` (tested on Node.js `v24.21.0`) and `npm`

### Install Dependencies
```powershell
npm install
```
*(Note: `postinstall` automatically runs `electron-builder install-app-deps` to ensure `better-sqlite3` is compiled/configured for the installed Electron ABI.)*

### Run in Development Mode
```powershell
npm run start
```

### Run Automated Smoke Verification Suite
```powershell
npm run test:smoke
```

### Build Windows NSIS Installer (`.exe`)
```powershell
npm run dist
```
The compiled Windows NSIS installer and unpacked production application will be generated in the `release/` or `dist/` output directory (`dist/Desktop Assistant Bot Setup 1.0.0.exe` and `dist/win-unpacked/`).

---

## 7. Known Limitations (Phase 1)

1. **Power Controls Disabled by Design**: System Shutdown and Restart buttons are intentionally disabled in Phase 1 for safety.
2. **OS Scope**: Lock Workstation (`user32.dll,LockWorkStation`) and `notepad.exe` launch are tailored specifically for Windows (`win32`).
3. **Reserved OS Shortcuts**: Windows-reserved combinations (such as `Win + L` or `Ctrl + Alt + Del`) cannot be overridden by Electron `globalShortcut`; if attempted, the application gracefully notifies the user and restores the previous working shortcut.
