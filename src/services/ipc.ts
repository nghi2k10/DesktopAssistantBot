import {
  ActionResult,
  InitialAppState,
  QuickLaunchTarget,
  SettingRow,
  ShortcutRegistrationResult,
  SystemAppInfo,
  ThemeMode
} from '../types.js';

export const ipcService = {
  getInitialState(): Promise<InitialAppState> {
    return window.assistantApi.getInitialState();
  },

  setTheme(theme: ThemeMode): Promise<{ success: boolean; theme?: ThemeMode; message: string }> {
    return window.assistantApi.setTheme(theme);
  },

  updateHotkey(shortcut: string): Promise<ShortcutRegistrationResult> {
    return window.assistantApi.updateHotkey(shortcut);
  },

  resetHotkey(): Promise<ShortcutRegistrationResult> {
    return window.assistantApi.resetHotkey();
  },

  setStartWithWindows(enabled: boolean): Promise<{ success: boolean; enabled?: boolean; message: string }> {
    return window.assistantApi.setStartWithWindows(enabled);
  },

  quickLaunch(target: QuickLaunchTarget): Promise<ActionResult> {
    return window.assistantApi.quickLaunch(target);
  },

  lockWorkstation(): Promise<ActionResult> {
    return window.assistantApi.lockWorkstation();
  },

  getApplicationInfo(): Promise<{ systemInfo: SystemAppInfo; settingsRows: SettingRow[] }> {
    return window.assistantApi.getApplicationInfo();
  },

  hideWindow(): Promise<{ success: boolean }> {
    return window.assistantApi.hideWindow();
  },

  exitApplication(): Promise<{ success: boolean }> {
    return window.assistantApi.exitApplication();
  },

  onHotkeyUpdated(callback: (payload: { accelerator: string; displayHotkey: string }) => void): () => void {
    return window.assistantApi.onHotkeyUpdated(callback);
  }
};
