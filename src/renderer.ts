import { SidebarComponent } from './components/sidebar.js';
import { toast } from './components/toast.js';
import { DashboardPage } from './pages/dashboard/index.js';
import { LauncherPage } from './pages/launcher/index.js';
import { SettingsPage } from './pages/settings/index.js';
import { ipcService } from './services/ipc.js';
import {
  InitialAppState,
  NavigationPage,
  QuickLaunchTarget,
  ThemeMode
} from './types.js';

class DesktopAssistantRenderer {
  private state: InitialAppState | null = null;
  private sidebar: SidebarComponent | null = null;
  private dashboardPage: DashboardPage | null = null;
  private launcherPage: LauncherPage | null = null;
  private settingsPage: SettingsPage | null = null;

  public async init(): Promise<void> {
    toast.init();

    try {
      this.state = await ipcService.getInitialState();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      toast.show(`Failed to load initial state: ${msg}`, 'error');
      return;
    }

    this.applyThemeToDom(this.state.settings.theme);

    const dashboardContainer = document.getElementById('page-dashboard');
    const launcherContainer = document.getElementById('page-launcher');
    const settingsContainer = document.getElementById('page-settings');

    if (!dashboardContainer || !launcherContainer || !settingsContainer) {
      return;
    }

    this.sidebar = new SidebarComponent({
      onNavigate: (page) => this.navigateTo(page),
      onHideToTray: () => this.handleHideToTray(),
      onExitApp: () => this.handleExitApp()
    });
    this.sidebar.init();
    this.sidebar.updateHotkeyBadge(this.state.displayHotkey);

    this.dashboardPage = new DashboardPage(dashboardContainer, {
      onQuickLaunch: (target) => this.handleQuickLaunch(target),
      onLockWorkstation: () => this.handleLockWorkstation(),
      onShowAppInfo: () => this.openAppInfoModal(),
      onNavigate: (page) => {
        this.sidebar?.setActivePage(page);
        this.navigateTo(page);
      }
    });

    this.launcherPage = new LauncherPage(launcherContainer, {
      onQuickLaunch: (target) => this.handleQuickLaunch(target)
    });

    this.settingsPage = new SettingsPage(settingsContainer, {
      onThemeChange: (theme) => this.handleThemeChange(theme),
      onUpdateHotkey: (rawShortcut) => this.handleUpdateHotkey(rawShortcut),
      onResetHotkey: () => this.handleResetHotkey(),
      onToggleStartWithWindows: (enabled) => this.handleToggleStartup(enabled)
    });

    // Render all pages with initial state
    this.dashboardPage.render(this.state);
    this.launcherPage.render(this.state.launcherItems);
    this.settingsPage.render(this.state);

    this.bindHeaderAndModalEvents();

    // Subscribe to hotkey updates from main process
    ipcService.onHotkeyUpdated(({ accelerator, displayHotkey }) => {
      if (this.state) {
        this.state.currentHotkey = accelerator;
        this.state.displayHotkey = displayHotkey;
        this.state.settings.global_hotkey = accelerator;
      }
      this.sidebar?.updateHotkeyBadge(displayHotkey);
      this.dashboardPage?.updateHotkey(displayHotkey);
      this.settingsPage?.updateHotkeyUI(displayHotkey);
    });

    // Expose helper for automated smoke test verification
    window.__testSetTheme = async (theme: ThemeMode) => {
      await this.handleThemeChange(theme);
    };
  }

  private bindHeaderAndModalEvents(): void {
    const themeToggleBtn = document.getElementById('header-theme-toggle');
    themeToggleBtn?.addEventListener('click', () => {
      if (!this.state) return;
      const nextTheme: ThemeMode = this.state.settings.theme === 'dark' ? 'light' : 'dark';
      this.handleThemeChange(nextTheme);
    });

    const headerInfoBtn = document.getElementById('header-app-info-btn');
    headerInfoBtn?.addEventListener('click', () => {
      this.openAppInfoModal();
    });

    const modalCloseBtn = document.getElementById('app-info-modal-close');
    const modalBackdrop = document.getElementById('app-info-modal');
    modalCloseBtn?.addEventListener('click', () => {
      this.closeAppInfoModal();
    });
    modalBackdrop?.addEventListener('click', (event) => {
      if (event.target === modalBackdrop) {
        this.closeAppInfoModal();
      }
    });
  }

  private navigateTo(page: NavigationPage): void {
    const pages: Record<NavigationPage, { elId: string; title: string; subtitle: string }> = {
      dashboard: {
        elId: 'page-dashboard',
        title: 'Dashboard',
        subtitle: 'System status, quick actions, and Windows workstation controls'
      },
      launcher: {
        elId: 'page-launcher',
        title: 'Quick Launcher',
        subtitle: 'Direct access to Windows user directories and core desktop tools'
      },
      settings: {
        elId: 'page-settings',
        title: 'Settings',
        subtitle: 'Personalize appearance, global hotkey, startup behavior, and local SQLite storage'
      }
    };

    (Object.keys(pages) as NavigationPage[]).forEach((key) => {
      const el = document.getElementById(pages[key].elId);
      if (el) {
        el.classList.toggle('hidden', key !== page);
      }
    });

    const titleEl = document.getElementById('page-title');
    const subtitleEl = document.getElementById('page-subtitle');
    if (titleEl) titleEl.textContent = pages[page].title;
    if (subtitleEl) subtitleEl.textContent = pages[page].subtitle;
  }

  private applyThemeToDom(theme: ThemeMode): void {
    document.documentElement.setAttribute('data-theme', theme);
    const themeLabel = document.getElementById('header-theme-label');
    if (themeLabel) {
      themeLabel.textContent = theme === 'dark' ? 'Dark Mode' : 'Light Mode';
    }
  }

  private async refreshSqliteRows(): Promise<void> {
    if (!this.state) return;
    try {
      const info = await ipcService.getApplicationInfo();
      this.state.settingsRows = info.settingsRows;
      this.state.systemInfo = info.systemInfo;
      this.settingsPage?.updateSqliteTable(info.settingsRows);
    } catch {
      // Ignore refresh error
    }
  }

  private async handleThemeChange(theme: ThemeMode): Promise<void> {
    if (!this.state) return;
    const result = await ipcService.setTheme(theme);
    if (result.success) {
      this.state.settings.theme = theme;
      this.applyThemeToDom(theme);
      this.settingsPage?.updateThemeSelectionUI(theme);
      await this.refreshSqliteRows();
      toast.show(result.message, 'success');
    } else {
      toast.show(result.message, 'error');
    }
  }

  private async handleUpdateHotkey(rawShortcut: string): Promise<void> {
    if (!this.state) return;
    const result = await ipcService.updateHotkey(rawShortcut);
    this.state.currentHotkey = result.accelerator;
    this.state.displayHotkey = result.displayHotkey;
    this.state.settings.global_hotkey = result.accelerator;

    this.sidebar?.updateHotkeyBadge(result.displayHotkey);
    this.dashboardPage?.updateHotkey(result.displayHotkey);
    this.settingsPage?.updateHotkeyUI(result.displayHotkey);
    await this.refreshSqliteRows();

    toast.show(result.message, result.success ? 'success' : 'error');
  }

  private async handleResetHotkey(): Promise<void> {
    if (!this.state) return;
    const result = await ipcService.resetHotkey();
    this.state.currentHotkey = result.accelerator;
    this.state.displayHotkey = result.displayHotkey;
    this.state.settings.global_hotkey = result.accelerator;

    this.sidebar?.updateHotkeyBadge(result.displayHotkey);
    this.dashboardPage?.updateHotkey(result.displayHotkey);
    this.settingsPage?.updateHotkeyUI(result.displayHotkey);
    await this.refreshSqliteRows();

    toast.show(result.message, result.success ? 'info' : 'error');
  }

  private async handleToggleStartup(enabled: boolean): Promise<void> {
    if (!this.state) return;
    const result = await ipcService.setStartWithWindows(enabled);
    if (result.success) {
      this.state.settings.start_with_windows = enabled;
      this.dashboardPage?.updateStartupStatus(enabled);
      await this.refreshSqliteRows();
      toast.show(result.message, 'success');
    } else {
      toast.show(result.message, 'error');
    }
  }

  private async handleQuickLaunch(target: QuickLaunchTarget): Promise<void> {
    const result = await ipcService.quickLaunch(target);
    toast.show(result.message, result.success ? 'success' : 'error');
  }

  private async handleLockWorkstation(): Promise<void> {
    toast.show('Locking Windows workstation...', 'info', 2000);
    const result = await ipcService.lockWorkstation();
    if (!result.success) {
      toast.show(result.message, 'error');
    }
  }

  private async openAppInfoModal(): Promise<void> {
    const modal = document.getElementById('app-info-modal');
    const body = document.getElementById('app-info-modal-body');
    if (!modal || !body) return;

    try {
      const { systemInfo } = await ipcService.getApplicationInfo();
      body.innerHTML = `
        <div class="modal-info-grid">
          <div class="modal-kv">
            <span>Application Name</span>
            <strong>${this.escapeHtml(systemInfo.appName)}</strong>
          </div>
          <div class="modal-kv">
            <span>Application Version</span>
            <strong>v${this.escapeHtml(systemInfo.appVersion)} (Phase 1)</strong>
          </div>
          <div class="modal-kv">
            <span>Operation Mode</span>
            <strong class="text-emerald">100% Offline • Local Only</strong>
          </div>
          <div class="modal-kv">
            <span>Global Hotkey</span>
            <strong>${this.escapeHtml(this.state?.displayHotkey || 'Ctrl + Shift + Space')}</strong>
          </div>
          <div class="modal-kv">
            <span>Electron Runtime</span>
            <strong>v${this.escapeHtml(systemInfo.electronVersion)}</strong>
          </div>
          <div class="modal-kv">
            <span>Node.js / Chromium</span>
            <strong>Node v${this.escapeHtml(systemInfo.nodeVersion)} • Chrome v${this.escapeHtml(systemInfo.chromeVersion)}</strong>
          </div>
          <div class="modal-kv">
            <span>OS Platform & Release</span>
            <strong>${this.escapeHtml(systemInfo.osType)} ${this.escapeHtml(systemInfo.osRelease)} (${this.escapeHtml(systemInfo.arch)})</strong>
          </div>
          <div class="modal-kv">
            <span>Host / Memory</span>
            <strong>${this.escapeHtml(systemInfo.hostname)} (${this.escapeHtml(systemInfo.freeMemoryGb)} free / ${this.escapeHtml(systemInfo.totalMemoryGb)})</strong>
          </div>
          <div class="modal-kv modal-kv-full">
            <span>User Data Directory</span>
            <code>${this.escapeHtml(systemInfo.userDataPath)}</code>
          </div>
          <div class="modal-kv modal-kv-full">
            <span>SQLite Database File</span>
            <code>${this.escapeHtml(systemInfo.databasePath)}</code>
          </div>
          <div class="modal-kv modal-kv-full">
            <span>Security Architecture</span>
            <strong>contextIsolation: true • nodeIntegration: false • sandbox: true • Strict CSP</strong>
          </div>
        </div>
      `;
      modal.classList.remove('hidden');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      toast.show(`Could not load application info: ${msg}`, 'error');
    }
  }

  private closeAppInfoModal(): void {
    const modal = document.getElementById('app-info-modal');
    modal?.classList.add('hidden');
  }

  private async handleHideToTray(): Promise<void> {
    await ipcService.hideWindow();
  }

  private async handleExitApp(): Promise<void> {
    await ipcService.exitApplication();
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const appRenderer = new DesktopAssistantRenderer();
  appRenderer.init();
});
