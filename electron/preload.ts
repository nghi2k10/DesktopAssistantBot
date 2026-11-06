import { contextBridge, ipcRenderer } from 'electron';

export type AllowedQuickLaunchTarget =
  | 'desktop'
  | 'downloads'
  | 'documents'
  | 'pictures'
  | 'notepad'
  | 'home';

const ALLOWED_TARGETS = new Set<string>([
  'desktop',
  'downloads',
  'documents',
  'pictures',
  'notepad',
  'home'
]);

const assistantApi = {
  getInitialState: () => ipcRenderer.invoke('assistant:get-initial-state'),

  setTheme: (theme: 'dark' | 'light') => {
    if (theme !== 'dark' && theme !== 'light') {
      return Promise.resolve({
        success: false,
        message: 'Invalid theme value. Expected "dark" or "light".'
      });
    }
    return ipcRenderer.invoke('assistant:set-theme', theme);
  },

  updateHotkey: (shortcut: string) => {
    if (typeof shortcut !== 'string' || shortcut.trim().length === 0 || shortcut.length > 64) {
      return Promise.resolve({
        success: false,
        accelerator: '',
        displayHotkey: '',
        message: 'Invalid shortcut string provided.'
      });
    }
    return ipcRenderer.invoke('assistant:update-hotkey', shortcut.trim());
  },

  resetHotkey: () => ipcRenderer.invoke('assistant:reset-hotkey'),

  setStartWithWindows: (enabled: boolean) => {
    if (typeof enabled !== 'boolean') {
      return Promise.resolve({
        success: false,
        message: 'Invalid boolean value for Start with Windows.'
      });
    }
    return ipcRenderer.invoke('assistant:set-start-with-windows', enabled);
  },

  quickLaunch: (target: AllowedQuickLaunchTarget) => {
    if (typeof target !== 'string' || !ALLOWED_TARGETS.has(target)) {
      return Promise.resolve({
        success: false,
        message: 'Disallowed quick launch target.'
      });
    }
    return ipcRenderer.invoke('assistant:quick-launch', target);
  },

  lockWorkstation: () => ipcRenderer.invoke('assistant:lock-workstation'),

  getApplicationInfo: () => ipcRenderer.invoke('assistant:get-app-info'),

  hideWindow: () => ipcRenderer.invoke('assistant:hide-window'),

  exitApplication: () => ipcRenderer.invoke('assistant:exit-app'),

  onHotkeyUpdated: (callback: (payload: { accelerator: string; displayHotkey: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { accelerator: string; displayHotkey: string }) => {
      callback(payload);
    };
    ipcRenderer.on('assistant:hotkey-changed', listener);
    return () => {
      ipcRenderer.removeListener('assistant:hotkey-changed', listener);
    };
  }
};

contextBridge.exposeInMainWorld('assistantApi', assistantApi);
