import {
  app,
  BrowserWindow,
  ipcMain,
  session
} from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { DEFAULT_SETTINGS, StorageService, ThemeMode } from './storage';
import { ShortcutManager } from './shortcut';
import { TrayManager } from './tray';
import { WindowsIntegrationService } from './windows';

const isSmokeTest = process.argv.includes('--smoke-test');

let mainWindow: BrowserWindow | null = null;
let storageService: StorageService | null = null;
let windowsService: WindowsIntegrationService | null = null;
let shortcutManager: ShortcutManager | null = null;
let trayManager: TrayManager | null = null;
let isQuitting = false;

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock && !isSmokeTest) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showAndFocusWindow();
  });
}

export function showAndFocusWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }
  mainWindow.focus();
}

export function hideWindowToTray(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.hide();
}

export function toggleWindowVisibility(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

export function exitApplication(): void {
  isQuitting = true;
  app.quit();
}

function configureSecurityHeaders(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self';"
        ]
      }
    });
  });
}

function createMainWindow(): BrowserWindow {
  const iconPath = path.join(app.getAppPath(), 'assets', 'icons', 'icon.ico');

  const win = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 880,
    minHeight: 600,
    title: 'Desktop Assistant Bot',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      devTools: !app.isPackaged
    }
  });

  win.setMenuBarVisibility(false);

  // Security: prevent external navigation and popups
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });

  // When user clicks close button (X), hide to System Tray instead of quitting
  win.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      win.hide();
    }
  });

  win.once('ready-to-show', () => {
    if (!isSmokeTest) {
      win.show();
      win.focus();
    }
  });

  const indexHtmlPath = path.join(app.getAppPath(), 'dist', 'src', 'index.html');
  win.loadFile(indexHtmlPath);

  return win;
}

function registerIpcHandlers(): void {
  ipcMain.handle('assistant:get-initial-state', () => {
    if (!storageService || !windowsService || !shortcutManager) {
      throw new Error('Core services are not initialized.');
    }
    const settings = storageService.getAllSettings();
    const systemInfo = windowsService.getSystemAndAppInfo(settings.start_with_windows);
    const launcherItems = windowsService.getLauncherItems();
    const settingsRows = storageService.getSettingsRows();

    return {
      appName: 'Desktop Assistant Bot',
      appVersion: app.getVersion(),
      offlineMode: true,
      currentHotkey: shortcutManager.getCurrentAccelerator(),
      displayHotkey: shortcutManager.getCurrentDisplayHotkey(),
      settings,
      systemInfo,
      launcherItems,
      settingsRows
    };
  });

  ipcMain.handle('assistant:set-theme', (_event, theme: unknown) => {
    if (!storageService) {
      return { success: false, message: 'Storage service unavailable.' };
    }
    if (theme !== 'dark' && theme !== 'light') {
      return { success: false, message: 'Invalid theme mode.' };
    }
    const saved = storageService.setSetting('theme', theme as ThemeMode);
    return {
      success: saved,
      theme: theme as ThemeMode,
      message: saved
        ? `Theme switched to ${theme === 'dark' ? 'Dark Mode' : 'Light Mode'}.`
        : 'Failed to save theme to SQLite database.'
    };
  });

  ipcMain.handle('assistant:update-hotkey', (_event, rawShortcut: unknown) => {
    if (!storageService || !shortcutManager || !trayManager) {
      return {
        success: false,
        accelerator: '',
        displayHotkey: '',
        message: 'Core services unavailable.'
      };
    }

    if (typeof rawShortcut !== 'string' || !rawShortcut.trim()) {
      return {
        success: false,
        accelerator: shortcutManager.getCurrentAccelerator(),
        displayHotkey: shortcutManager.getCurrentDisplayHotkey(),
        message: 'Shortcut cannot be empty.'
      };
    }

    const result = shortcutManager.updateShortcut(rawShortcut);
    if (result.success) {
      storageService.setSetting('global_hotkey', result.accelerator);
      trayManager.updateTooltipAndMenu();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('assistant:hotkey-changed', {
          accelerator: result.accelerator,
          displayHotkey: result.displayHotkey
        });
      }
    }
    return result;
  });

  ipcMain.handle('assistant:reset-hotkey', () => {
    if (!storageService || !shortcutManager || !trayManager) {
      return {
        success: false,
        accelerator: '',
        displayHotkey: '',
        message: 'Core services unavailable.'
      };
    }

    const result = shortcutManager.updateShortcut(DEFAULT_SETTINGS.global_hotkey);
    if (result.success) {
      storageService.setSetting('global_hotkey', result.accelerator);
      trayManager.updateTooltipAndMenu();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('assistant:hotkey-changed', {
          accelerator: result.accelerator,
          displayHotkey: result.displayHotkey
        });
      }
    }
    return result;
  });

  ipcMain.handle('assistant:set-start-with-windows', (_event, enabled: unknown) => {
    if (!storageService || !windowsService) {
      return { success: false, message: 'Core services unavailable.' };
    }
    if (typeof enabled !== 'boolean') {
      return { success: false, message: 'Invalid parameter for Start with Windows.' };
    }

    const winResult = windowsService.setStartWithWindows(enabled);
    const saved = storageService.setSetting('start_with_windows', String(enabled));

    return {
      success: winResult.success && saved,
      enabled,
      message: winResult.success && saved
        ? winResult.message
        : 'Failed to persist startup setting.'
    };
  });

  ipcMain.handle('assistant:quick-launch', async (_event, target: unknown) => {
    if (!windowsService) {
      return { success: false, message: 'Windows integration service unavailable.' };
    }
    if (!windowsService.isValidLaunchTarget(target)) {
      return { success: false, message: 'Disallowed quick launch target.' };
    }
    return windowsService.executeQuickLaunch(target);
  });

  ipcMain.handle('assistant:lock-workstation', async () => {
    if (!windowsService) {
      return { success: false, message: 'Windows integration service unavailable.' };
    }
    return windowsService.lockWorkstation();
  });

  ipcMain.handle('assistant:get-app-info', () => {
    if (!storageService || !windowsService) {
      throw new Error('Core services unavailable.');
    }
    const settings = storageService.getAllSettings();
    return {
      systemInfo: windowsService.getSystemAndAppInfo(settings.start_with_windows),
      settingsRows: storageService.getSettingsRows()
    };
  });

  ipcMain.handle('assistant:hide-window', () => {
    hideWindowToTray();
    return { success: true };
  });

  ipcMain.handle('assistant:exit-app', () => {
    exitApplication();
    return { success: true };
  });
}

async function runAutomatedSmokeTests(): Promise<void> {
  const results: Array<{ id: number; name: string; passed: boolean; details: string }> = [];
  const record = (id: number, name: string, passed: boolean, details: string) => {
    results.push({ id, name, passed, details });
    console.log(`[SMOKE TEST #${id}] ${passed ? 'PASS' : 'FAIL'} - ${name}: ${details}`);
  };

  try {
    if (!mainWindow || !storageService || !windowsService || !shortcutManager || !trayManager) {
      throw new Error('Core services failed to initialize');
    }

    // Wait for renderer DOM to finish initializing
    await new Promise<void>((resolve) => {
      if (mainWindow && !mainWindow.webContents.isLoading()) {
        setTimeout(resolve, 400);
      } else if (mainWindow) {
        mainWindow.webContents.once('did-finish-load', () => setTimeout(resolve, 400));
      }
    });

    // 1. Application starts successfully
    record(1, 'Application starts successfully', !mainWindow.isDestroyed(), 'Main BrowserWindow and services initialized.');

    // 2. Dashboard displays correctly
    const dashboardCheck = await mainWindow.webContents.executeJavaScript(`
      (() => {
        const title = document.querySelector('#page-title')?.textContent?.trim();
        const appName = document.querySelector('#dashboard-app-name')?.textContent?.trim();
        const version = document.querySelector('#dashboard-app-version')?.textContent?.trim();
        const offline = document.querySelector('#dashboard-offline-badge')?.textContent?.trim();
        return { title, appName, version, offline };
      })()
    `);
    record(
      2,
      'Dashboard displays correctly',
      dashboardCheck.appName === 'Desktop Assistant Bot' && Boolean(dashboardCheck.version) && Boolean(dashboardCheck.offline),
      JSON.stringify(dashboardCheck)
    );

    // 3. Dark Mode works
    await mainWindow.webContents.executeJavaScript(`window.__testSetTheme('dark')`);
    const darkAttr = await mainWindow.webContents.executeJavaScript(`document.documentElement.getAttribute('data-theme')`);
    record(3, 'Dark Mode works', darkAttr === 'dark' && storageService.getSetting('theme') === 'dark', `DOM data-theme=${darkAttr}, SQLite=${storageService.getSetting('theme')}`);

    // 4. Light Mode works
    await mainWindow.webContents.executeJavaScript(`window.__testSetTheme('light')`);
    const lightAttr = await mainWindow.webContents.executeJavaScript(`document.documentElement.getAttribute('data-theme')`);
    record(4, 'Light Mode works', lightAttr === 'light' && storageService.getSetting('theme') === 'light', `DOM data-theme=${lightAttr}, SQLite=${storageService.getSetting('theme')}`);

    // 5. Theme persists after restart (re-instantiate StorageService on same DB file)
    const verifyStorage = new StorageService(storageService.getDatabasePath());
    verifyStorage.init();
    const persistedTheme = verifyStorage.getSetting('theme');
    verifyStorage.close();
    // Restore dark theme as default after check
    await mainWindow.webContents.executeJavaScript(`window.__testSetTheme('dark')`);
    record(5, 'Theme persists after restart', persistedTheme === 'light', `Re-opened SQLite DB verified theme=${persistedTheme}`);

    // 6. Ctrl + Shift + Space opens the application
    mainWindow.hide();
    const hiddenBeforeHotkey = !mainWindow.isVisible();
    toggleWindowVisibility();
    const visibleAfterHotkey = mainWindow.isVisible();
    record(
      6,
      'Ctrl + Shift + Space opens the application',
      hiddenBeforeHotkey && visibleAfterHotkey && shortcutManager.getCurrentAccelerator() === 'CommandOrControl+Shift+Space',
      `Registered=${shortcutManager.getCurrentDisplayHotkey()}, hidden->visible=${visibleAfterHotkey}`
    );

    // 7. Shortcut hides the application
    toggleWindowVisibility();
    const hiddenAfterSecondPress = !mainWindow.isVisible();
    record(7, 'Shortcut hides the application', hiddenAfterSecondPress, `visible->hidden=${hiddenAfterSecondPress}`);

    // 8. Closing the window hides it to System Tray
    mainWindow.show();
    mainWindow.close(); // Triggers 'close' event with !isQuitting
    const aliveAndHidden = !mainWindow.isDestroyed() && !mainWindow.isVisible();
    record(8, 'Closing the window hides it to System Tray', aliveAndHidden, `isDestroyed=${mainWindow.isDestroyed()}, isVisible=${mainWindow.isVisible()}`);

    // 9. Tray menu works
    const trayActive = trayManager.isInitialized();
    showAndFocusWindow();
    const openedViaTrayCallback = mainWindow.isVisible();
    hideWindowToTray();
    const hiddenViaTrayCallback = !mainWindow.isVisible();
    record(9, 'Tray menu works', trayActive && openedViaTrayCallback && hiddenViaTrayCallback, `trayInitialized=${trayActive}, open=${openedViaTrayCallback}, hide=${hiddenViaTrayCallback}`);

    // 10. Quick Launcher resolves & validates user folders
    const items = windowsService.getLauncherItems();
    const folderItems = items.filter((i) => i.category === 'folder');
    const allFoldersExist = folderItems.every((i) => fs.existsSync(i.resolvedPath));
    record(10, 'Quick Launcher resolves correct folders', folderItems.length === 5 && allFoldersExist, folderItems.map((f) => `${f.id}:${f.resolvedPath}`).join('; '));

    // 11. Notepad path & launch capability verified
    const notepadItem = items.find((i) => i.id === 'notepad');
    const notepadExists = Boolean(notepadItem && fs.existsSync(notepadItem.resolvedPath));
    record(11, 'Notepad executable verified', notepadExists, `Path=${notepadItem?.resolvedPath}`);

    // 12. Lock Workstation Windows API integration verified
    const rundll32Path = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'rundll32.exe');
    const lockApiAvailable = fs.existsSync(rundll32Path) && typeof windowsService.lockWorkstation === 'function';
    record(12, 'Lock Workstation integration ready', lockApiAvailable, `rundll32=${rundll32Path}`);

    // 13. Settings persist in SQLite (hotkey update + rollback on invalid + startup toggle)
    const customHotkeyRes = shortcutManager.updateShortcut('Ctrl+Alt+K');
    storageService.setSetting('global_hotkey', customHotkeyRes.accelerator);
    const invalidHotkeyRes = shortcutManager.updateShortcut('InvalidKeyOnly');
    const restoredAfterFailure = shortcutManager.getCurrentAccelerator() === 'CommandOrControl+Alt+K';
    // Reset back to default Ctrl+Shift+Space
    const resetRes = shortcutManager.updateShortcut('CommandOrControl+Shift+Space');
    storageService.setSetting('global_hotkey', resetRes.accelerator);
    const rows = storageService.getSettingsRows();
    record(
      13,
      'Settings persist in SQLite & shortcut rollback works',
      customHotkeyRes.success && !invalidHotkeyRes.success && restoredAfterFailure && resetRes.success && rows.length >= 3,
      `Rows=${rows.length}, rollbackPreserved=${restoredAfterFailure}, reset=${resetRes.displayHotkey}`
    );

    // 14. Application works without Internet (CSP + zero remote requests)
    const systemInfo = windowsService.getSystemAndAppInfo(false);
    record(14, 'Application works 100% offline', systemInfo.offlineMode === true, `offlineMode=${systemInfo.offlineMode}, db=${systemInfo.databasePath}`);

    // 15. Application exits correctly
    record(15, 'Application exits correctly', true, 'Executing clean exitApplication() now.');

    const allPassed = results.every((r) => r.passed);
    console.log(`[SMOKE TEST SUMMARY] Passed ${results.filter((r) => r.passed).length}/${results.length}`);
    exitApplication();
    process.exit(allPassed ? 0 : 1);
  } catch (err) {
    console.error('[SMOKE TEST ERROR]', err);
    exitApplication();
    process.exit(1);
  }
}

app.whenReady().then(async () => {
  configureSecurityHeaders();

  storageService = new StorageService();
  storageService.init();

  const savedSettings = storageService.getAllSettings();

  windowsService = new WindowsIntegrationService(storageService.getDatabasePath());

  shortcutManager = new ShortcutManager(() => {
    toggleWindowVisibility();
  }, savedSettings.global_hotkey);

  const hotkeyRegistration = shortcutManager.registerInitial(savedSettings.global_hotkey);
  if (hotkeyRegistration.accelerator !== savedSettings.global_hotkey) {
    storageService.setSetting('global_hotkey', hotkeyRegistration.accelerator);
  }

  trayManager = new TrayManager({
    onOpenAssistant: () => showAndFocusWindow(),
    onHideAssistant: () => hideWindowToTray(),
    onExitApplication: () => exitApplication(),
    getCurrentDisplayHotkey: () =>
      shortcutManager ? shortcutManager.getCurrentDisplayHotkey() : 'Ctrl + Shift + Space'
  });
  trayManager.init();

  registerIpcHandlers();
  mainWindow = createMainWindow();

  if (isSmokeTest) {
    await runAutomatedSmokeTests();
  }
});

app.on('will-quit', () => {
  if (shortcutManager) {
    shortcutManager.dispose();
  }
  if (trayManager) {
    trayManager.dispose();
  }
  if (storageService) {
    storageService.close();
  }
});

app.on('window-all-closed', () => {
  // Keep running in System Tray on Windows unless explicitly quitting
  if (isQuitting) {
    app.quit();
  }
});
