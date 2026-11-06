import {
  InitialAppState,
  LauncherItemInfo,
  NavigationPage,
  QuickLaunchTarget
} from '../../types.js';

export interface DashboardCallbacks {
  onQuickLaunch: (target: QuickLaunchTarget) => void;
  onLockWorkstation: () => void;
  onShowAppInfo: () => void;
  onNavigate: (page: NavigationPage) => void;
}

export class DashboardPage {
  private readonly container: HTMLElement;
  private readonly callbacks: DashboardCallbacks;

  constructor(container: HTMLElement, callbacks: DashboardCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
  }

  public render(state: InitialAppState): void {
    const { appName, appVersion, displayHotkey, systemInfo, launcherItems } = state;

    this.container.innerHTML = `
      <div class="dashboard-grid">
        <!-- Hero Status Banner -->
        <section class="card hero-card">
          <div class="hero-left">
            <div class="hero-title-row">
              <h2 id="dashboard-app-name" class="hero-title">${this.escapeHtml(appName)}</h2>
              <span id="dashboard-app-version" class="badge badge-accent">v${this.escapeHtml(appVersion)}</span>
              <span id="dashboard-offline-badge" class="badge badge-offline">
                <span class="status-dot"></span>
                Offline Ready • Local Storage
              </span>
            </div>
            <p class="hero-subtitle">
              Lightweight personal Windows productivity assistant running silently in the System Tray.
              No cloud services, no telemetry, 100% local SQLite storage.
            </p>
            <div class="hero-meta-pills">
              <div class="meta-pill">
                <span class="meta-pill-label">Global Hotkey</span>
                <kbd id="dashboard-hotkey-value" class="kbd-shortcut">${this.escapeHtml(displayHotkey)}</kbd>
              </div>
              <div class="meta-pill">
                <span class="meta-pill-label">Database</span>
                <span class="meta-pill-val">SQLite (WAL Mode)</span>
              </div>
              <div class="meta-pill">
                <span class="meta-pill-label">Start with Windows</span>
                <span id="dashboard-startup-status" class="meta-pill-val">${
                  state.settings.start_with_windows ? 'Enabled' : 'Disabled'
                }</span>
              </div>
            </div>
          </div>
          <div class="hero-right">
            <button type="button" class="btn btn-secondary" id="dashboard-change-hotkey-btn">
              Configure Hotkey
            </button>
          </div>
        </section>

        <!-- System Status Summary -->
        <section class="status-strip">
          <div class="card stat-card">
            <div class="stat-icon stat-icon-blue">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
            </div>
            <div class="stat-content">
              <span class="stat-label">Platform & Architecture</span>
              <strong class="stat-value">Windows (${this.escapeHtml(systemInfo.arch)}) • ${this.escapeHtml(systemInfo.osRelease)}</strong>
            </div>
          </div>

          <div class="card stat-card">
            <div class="stat-icon stat-icon-emerald">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            </div>
            <div class="stat-content">
              <span class="stat-label">Privacy & Network</span>
              <strong class="stat-value">100% Offline • Isolated</strong>
            </div>
          </div>

          <div class="card stat-card">
            <div class="stat-icon stat-icon-purple">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>
            </div>
            <div class="stat-content">
              <span class="stat-label">System Memory</span>
              <strong class="stat-value">${this.escapeHtml(systemInfo.freeMemoryGb)} free / ${this.escapeHtml(systemInfo.totalMemoryGb)}</strong>
            </div>
          </div>
        </section>

        <!-- Quick Actions Section -->
        <section class="section-block">
          <div class="section-header">
            <div>
              <h3 class="section-title">Quick Actions</h3>
              <p class="section-desc">Instant access to essential Windows folders and tools</p>
            </div>
            <button type="button" class="btn btn-ghost" id="dashboard-view-all-launcher">
              Open Quick Launcher &rarr;
            </button>
          </div>
          <div class="quick-actions-grid">
            ${launcherItems.map((item) => this.renderQuickActionCard(item)).join('')}
          </div>
        </section>

        <!-- Windows Controls & Application Info Section -->
        <section class="section-block">
          <div class="section-header">
            <div>
              <h3 class="section-title">Windows Controls & System</h3>
              <p class="section-desc">Workstation security controls and diagnostic metadata</p>
            </div>
          </div>
          <div class="controls-grid">
            <div class="card control-card">
              <div class="control-card-top">
                <div class="control-icon control-icon-amber">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                </div>
                <div>
                  <h4 class="control-title">Lock Workstation</h4>
                  <p class="control-desc">Immediately lock your Windows session using native User32 API</p>
                </div>
              </div>
              <div class="control-card-footer">
                <button type="button" class="btn btn-primary" id="dashboard-lock-btn">
                  Lock Windows Now
                </button>
              </div>
            </div>

            <div class="card control-card">
              <div class="control-card-top">
                <div class="control-icon control-icon-blue">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                </div>
                <div>
                  <h4 class="control-title">Application Information</h4>
                  <p class="control-desc">Inspect runtime versions, local SQLite path, and security state</p>
                </div>
              </div>
              <div class="control-card-footer">
                <button type="button" class="btn btn-secondary" id="dashboard-app-info-btn">
                  Display Application Info
                </button>
              </div>
            </div>

            <div class="card control-card control-card-disabled" aria-disabled="true">
              <div class="control-card-top">
                <div class="control-icon control-icon-muted">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>
                </div>
                <div>
                  <div class="control-title-row">
                    <h4 class="control-title">Shutdown / Restart</h4>
                    <span class="badge badge-muted">Phase 2</span>
                  </div>
                  <p class="control-desc">Power state actions are intentionally disabled in Phase 1 for safety</p>
                </div>
              </div>
              <div class="control-card-footer split-buttons">
                <button type="button" class="btn btn-disabled" disabled title="Disabled in Phase 1">
                  Shutdown PC
                </button>
                <button type="button" class="btn btn-disabled" disabled title="Disabled in Phase 1">
                  Restart PC
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
    `;

    this.bindEvents();
  }

  private renderQuickActionCard(item: LauncherItemInfo): string {
    return `
      <button type="button" class="card action-tile" data-quick-launch="${this.escapeHtml(item.id)}">
        <div class="action-tile-icon ${item.category === 'application' ? 'icon-app' : 'icon-folder'}">
          ${this.getLauncherSvg(item.id)}
        </div>
        <div class="action-tile-body">
          <span class="action-tile-title">${this.escapeHtml(item.label)}</span>
          <span class="action-tile-sub">${this.escapeHtml(
            item.category === 'application' ? 'System Utility' : 'Windows Folder'
          )}</span>
        </div>
        <span class="action-tile-arrow" aria-hidden="true">&rarr;</span>
      </button>
    `;
  }

  private bindEvents(): void {
    const launchButtons = this.container.querySelectorAll<HTMLButtonElement>('[data-quick-launch]');
    launchButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.getAttribute('data-quick-launch') as QuickLaunchTarget | null;
        if (target) {
          this.callbacks.onQuickLaunch(target);
        }
      });
    });

    const lockBtn = this.container.querySelector('#dashboard-lock-btn');
    lockBtn?.addEventListener('click', () => {
      this.callbacks.onLockWorkstation();
    });

    const appInfoBtn = this.container.querySelector('#dashboard-app-info-btn');
    appInfoBtn?.addEventListener('click', () => {
      this.callbacks.onShowAppInfo();
    });

    const changeHotkeyBtn = this.container.querySelector('#dashboard-change-hotkey-btn');
    changeHotkeyBtn?.addEventListener('click', () => {
      this.callbacks.onNavigate('settings');
    });

    const viewAllLauncherBtn = this.container.querySelector('#dashboard-view-all-launcher');
    viewAllLauncherBtn?.addEventListener('click', () => {
      this.callbacks.onNavigate('launcher');
    });
  }

  public updateHotkey(displayHotkey: string): void {
    const el = this.container.querySelector('#dashboard-hotkey-value');
    if (el) {
      el.textContent = displayHotkey;
    }
  }

  public updateStartupStatus(enabled: boolean): void {
    const el = this.container.querySelector('#dashboard-startup-status');
    if (el) {
      el.textContent = enabled ? 'Enabled' : 'Disabled';
    }
  }

  private getLauncherSvg(id: QuickLaunchTarget): string {
    switch (id) {
      case 'desktop':
        return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`;
      case 'downloads':
        return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
      case 'documents':
        return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`;
      case 'pictures':
        return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
      case 'home':
        return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`;
      case 'notepad':
        return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`;
    }
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
