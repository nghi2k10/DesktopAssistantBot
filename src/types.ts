export type ThemeMode = 'dark' | 'light';

export type NavigationPage = 'dashboard' | 'launcher' | 'settings';

export type QuickLaunchTarget =
  | 'desktop'
  | 'downloads'
  | 'documents'
  | 'pictures'
  | 'notepad'
  | 'home';

export interface LauncherItemInfo {
  id: QuickLaunchTarget;
  label: string;
  description: string;
  category: 'folder' | 'application';
  resolvedPath: string;
}

export interface SettingRow {
  id: number;
  key: string;
  value: string;
  updated_at: string;
}

export interface AppSettings {
  theme: ThemeMode;
  global_hotkey: string;
  start_with_windows: boolean;
}

export interface SystemAppInfo {
  appName: string;
  appVersion: string;
  electronVersion: string;
  nodeVersion: string;
  chromeVersion: string;
  v8Version: string;
  platform: string;
  arch: string;
  osType: string;
  osRelease: string;
  hostname: string;
  totalMemoryGb: string;
  freeMemoryGb: string;
  uptimeMinutes: number;
  userDataPath: string;
  databasePath: string;
  offlineMode: boolean;
  startWithWindows: boolean;
}

export interface InitialAppState {
  appName: string;
  appVersion: string;
  offlineMode: boolean;
  currentHotkey: string;
  displayHotkey: string;
  settings: AppSettings;
  systemInfo: SystemAppInfo;
  launcherItems: LauncherItemInfo[];
  settingsRows: SettingRow[];
}

export interface ActionResult {
  success: boolean;
  message: string;
  targetPath?: string;
}

export interface ShortcutRegistrationResult {
  success: boolean;
  accelerator: string;
  displayHotkey: string;
  message: string;
}

export interface AssistantBridgeApi {
  getInitialState: () => Promise<InitialAppState>;
  setTheme: (theme: ThemeMode) => Promise<{ success: boolean; theme?: ThemeMode; message: string }>;
  updateHotkey: (shortcut: string) => Promise<ShortcutRegistrationResult>;
  resetHotkey: () => Promise<ShortcutRegistrationResult>;
  setStartWithWindows: (enabled: boolean) => Promise<{ success: boolean; enabled?: boolean; message: string }>;
  quickLaunch: (target: QuickLaunchTarget) => Promise<ActionResult>;
  lockWorkstation: () => Promise<ActionResult>;
  getApplicationInfo: () => Promise<{ systemInfo: SystemAppInfo; settingsRows: SettingRow[] }>;
  hideWindow: () => Promise<{ success: boolean }>;
  exitApplication: () => Promise<{ success: boolean }>;
  onHotkeyUpdated: (callback: (payload: { accelerator: string; displayHotkey: string }) => void) => () => void;
}

declare global {
  interface Window {
    assistantApi: AssistantBridgeApi;
    __testSetTheme?: (theme: ThemeMode) => Promise<void>;
  }
}
