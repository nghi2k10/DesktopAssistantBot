import { app, shell } from 'electron';
import { execFile, spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

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

export interface ActionResult {
  success: boolean;
  message: string;
  targetPath?: string;
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

const VALID_TARGETS: ReadonlySet<string> = new Set<QuickLaunchTarget>([
  'desktop',
  'downloads',
  'documents',
  'pictures',
  'notepad',
  'home'
]);

export class WindowsIntegrationService {
  private readonly databasePath: string;

  constructor(databasePath: string) {
    this.databasePath = databasePath;
  }

  public isValidLaunchTarget(target: unknown): target is QuickLaunchTarget {
    return typeof target === 'string' && VALID_TARGETS.has(target);
  }

  private getNotepadExecutablePath(): string {
    const systemRoot = process.env.SystemRoot || 'C:\\Windows';
    const sys32Notepad = path.join(systemRoot, 'System32', 'notepad.exe');
    if (fs.existsSync(sys32Notepad)) {
      return sys32Notepad;
    }
    return 'notepad.exe';
  }

  public resolveTargetPath(target: QuickLaunchTarget): string {
    switch (target) {
      case 'desktop':
        return app.getPath('desktop');
      case 'downloads':
        return app.getPath('downloads');
      case 'documents':
        return app.getPath('documents');
      case 'pictures':
        return app.getPath('pictures');
      case 'home':
        return app.getPath('home');
      case 'notepad':
        return this.getNotepadExecutablePath();
    }
  }

  public getLauncherItems(): LauncherItemInfo[] {
    return [
      {
        id: 'desktop',
        label: 'Desktop Folder',
        description: 'Open your Windows Desktop directory in File Explorer',
        category: 'folder',
        resolvedPath: this.resolveTargetPath('desktop')
      },
      {
        id: 'downloads',
        label: 'Downloads Folder',
        description: 'Access recently downloaded files and installers',
        category: 'folder',
        resolvedPath: this.resolveTargetPath('downloads')
      },
      {
        id: 'documents',
        label: 'Documents Folder',
        description: 'Open your personal Windows Documents directory',
        category: 'folder',
        resolvedPath: this.resolveTargetPath('documents')
      },
      {
        id: 'pictures',
        label: 'Pictures Folder',
        description: 'Browse screenshots, photos, and saved images',
        category: 'folder',
        resolvedPath: this.resolveTargetPath('pictures')
      },
      {
        id: 'home',
        label: 'User Home Directory',
        description: 'Open your Windows User Profile root folder',
        category: 'folder',
        resolvedPath: this.resolveTargetPath('home')
      },
      {
        id: 'notepad',
        label: 'Windows Notepad',
        description: 'Launch the native Windows Notepad text editor',
        category: 'application',
        resolvedPath: this.resolveTargetPath('notepad')
      }
    ];
  }

  public async executeQuickLaunch(target: QuickLaunchTarget): Promise<ActionResult> {
    if (!this.isValidLaunchTarget(target)) {
      return {
        success: false,
        message: 'Invalid quick launch target requested.'
      };
    }

    if (target === 'notepad') {
      return this.launchNotepad();
    }

    const folderPath = this.resolveTargetPath(target);
    try {
      if (!fs.existsSync(folderPath)) {
        return {
          success: false,
          message: `Directory does not exist: ${folderPath}`,
          targetPath: folderPath
        };
      }

      const errorMessage = await shell.openPath(folderPath);
      if (errorMessage) {
        return {
          success: false,
          message: `Failed to open folder: ${errorMessage}`,
          targetPath: folderPath
        };
      }

      const friendlyName = target.charAt(0).toUpperCase() + target.slice(1);
      return {
        success: true,
        message: `Opened ${friendlyName} folder successfully.`,
        targetPath: folderPath
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Error opening folder: ${msg}`,
        targetPath: folderPath
      };
    }
  }

  public launchNotepad(): Promise<ActionResult> {
    return new Promise((resolve) => {
      try {
        const notepadPath = this.getNotepadExecutablePath();
        const child = spawn(notepadPath, [], {
          detached: true,
          stdio: 'ignore',
          windowsHide: false
        });

        child.on('error', (err) => {
          resolve({
            success: false,
            message: `Failed to launch Windows Notepad: ${err.message}`,
            targetPath: notepadPath
          });
        });

        child.unref();
        resolve({
          success: true,
          message: 'Windows Notepad launched successfully.',
          targetPath: notepadPath
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        resolve({
          success: false,
          message: `Error launching Windows Notepad: ${msg}`
        });
      }
    });
  }

  public lockWorkstation(): Promise<ActionResult> {
    return new Promise((resolve) => {
      if (process.platform !== 'win32') {
        resolve({
          success: false,
          message: 'Lock Workstation is only supported on Windows.'
        });
        return;
      }

      const systemRoot = process.env.SystemRoot || 'C:\\Windows';
      const rundll32Path = path.join(systemRoot, 'System32', 'rundll32.exe');

      execFile(
        rundll32Path,
        ['user32.dll,LockWorkStation'],
        { windowsHide: true },
        (error) => {
          if (error) {
            resolve({
              success: false,
              message: `Failed to lock workstation: ${error.message}`
            });
            return;
          }
          resolve({
            success: true,
            message: 'Workstation locked successfully.'
          });
        }
      );
    });
  }

  public setStartWithWindows(enabled: boolean): ActionResult {
    try {
      app.setLoginItemSettings({
        openAtLogin: enabled,
        path: process.execPath
      });
      return {
        success: true,
        message: enabled
          ? 'Enabled Start with Windows.'
          : 'Disabled Start with Windows.'
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to update Windows startup setting: ${msg}`
      };
    }
  }

  public getStartWithWindowsStatus(): boolean {
    try {
      const settings = app.getLoginItemSettings();
      return Boolean(settings.openAtLogin);
    } catch {
      return false;
    }
  }

  public getSystemAndAppInfo(persistedStartupSetting: boolean): SystemAppInfo {
    const totalMem = os.totalmem() / (1024 * 1024 * 1024);
    const freeMem = os.freemem() / (1024 * 1024 * 1024);

    return {
      appName: 'Desktop Assistant Bot',
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron || 'Unknown',
      nodeVersion: process.versions.node || 'Unknown',
      chromeVersion: process.versions.chrome || 'Unknown',
      v8Version: process.versions.v8 || 'Unknown',
      platform: process.platform,
      arch: process.arch,
      osType: os.type(),
      osRelease: os.release(),
      hostname: os.hostname(),
      totalMemoryGb: `${totalMem.toFixed(1)} GB`,
      freeMemoryGb: `${freeMem.toFixed(1)} GB`,
      uptimeMinutes: Math.floor(os.uptime() / 60),
      userDataPath: app.getPath('userData'),
      databasePath: this.databasePath,
      offlineMode: true,
      startWithWindows: persistedStartupSetting
    };
  }
}
