import { app, Menu, nativeImage, Tray } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export interface TrayCallbacks {
  onOpenAssistant: () => void;
  onHideAssistant: () => void;
  onExitApplication: () => void;
  getCurrentDisplayHotkey: () => string;
}

export class TrayManager {
  private tray: Tray | null = null;
  private readonly callbacks: TrayCallbacks;

  constructor(callbacks: TrayCallbacks) {
    this.callbacks = callbacks;
  }

  public init(): void {
    if (this.tray) {
      return;
    }

    const iconImage = this.loadTrayIcon();
    this.tray = new Tray(iconImage);
    this.updateTooltipAndMenu();

    // Double-click tray icon to show the application
    this.tray.on('double-click', () => {
      this.callbacks.onOpenAssistant();
    });
  }

  private loadTrayIcon(): Electron.NativeImage {
    const appPath = app.getAppPath();
    const icoPath = path.join(appPath, 'assets', 'icons', 'icon.ico');
    const pngPath = path.join(appPath, 'assets', 'icons', 'tray.png');

    if (process.platform === 'win32' && fs.existsSync(icoPath)) {
      return nativeImage.createFromPath(icoPath);
    }
    if (fs.existsSync(pngPath)) {
      return nativeImage.createFromPath(pngPath);
    }
    return nativeImage.createEmpty();
  }

  public updateTooltipAndMenu(): void {
    if (!this.tray) {
      return;
    }

    const hotkey = this.callbacks.getCurrentDisplayHotkey();
    this.tray.setToolTip(`Desktop Assistant Bot (${hotkey})`);

    const contextMenu = Menu.buildFromTemplate([
      {
        label: `Desktop Assistant Bot v${app.getVersion()}`,
        enabled: false
      },
      {
        label: `Toggle Hotkey: ${hotkey}`,
        enabled: false
      },
      { type: 'separator' },
      {
        label: 'Open Assistant',
        click: () => {
          this.callbacks.onOpenAssistant();
        }
      },
      {
        label: 'Hide Assistant',
        click: () => {
          this.callbacks.onHideAssistant();
        }
      },
      { type: 'separator' },
      {
        label: 'Exit Application',
        click: () => {
          this.callbacks.onExitApplication();
        }
      }
    ]);

    this.tray.setContextMenu(contextMenu);
  }

  public isInitialized(): boolean {
    return this.tray !== null && !this.tray.isDestroyed();
  }

  public dispose(): void {
    if (this.tray && !this.tray.isDestroyed()) {
      this.tray.destroy();
      this.tray = null;
    }
  }
}
