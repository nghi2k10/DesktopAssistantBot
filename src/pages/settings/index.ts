import {
  InitialAppState,
  SettingRow,
  ThemeMode
} from '../../types.js';

export interface SettingsPageCallbacks {
  onThemeChange: (theme: ThemeMode) => Promise<void>;
  onUpdateHotkey: (rawShortcut: string) => Promise<void>;
  onResetHotkey: () => Promise<void>;
  onToggleStartWithWindows: (enabled: boolean) => Promise<void>;
}

export class SettingsPage {
  private readonly container: HTMLElement;
  private readonly callbacks: SettingsPageCallbacks;
  private isRecordingHotkey = false;
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(container: HTMLElement, callbacks: SettingsPageCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
  }

  public render(state: InitialAppState): void {
    this.cleanupRecorder();
    const { settings, displayHotkey, appVersion, systemInfo, settingsRows } = state;

    this.container.innerHTML = `
      <div class="settings-page">
        <!-- Appearance / Theme Card -->
        <section class="card settings-card">
          <div class="settings-card-header">
            <div>
              <h3 class="settings-section-title">Appearance & Theme</h3>
              <p class="settings-section-desc">Choose between Dark Mode and Light Mode. Persisted locally in SQLite.</p>
            </div>
            <span class="badge badge-neutral">Persisted</span>
          </div>

          <div class="theme-selector-grid">
            <button
              type="button"
              class="theme-option-card ${settings.theme === 'dark' ? 'selected' : ''}"
              data-theme-choice="dark"
            >
              <div class="theme-preview theme-preview-dark">
                <div class="preview-sidebar"></div>
                <div class="preview-content">
                  <div class="preview-bar"></div>
                  <div class="preview-cards">
                    <span></span><span></span>
                  </div>
                </div>
              </div>
              <div class="theme-option-meta">
                <strong>Dark Mode</strong>
                <span>Low-glare slate surface for night & studio work</span>
              </div>
            </button>

            <button
              type="button"
              class="theme-option-card ${settings.theme === 'light' ? 'selected' : ''}"
              data-theme-choice="light"
            >
              <div class="theme-preview theme-preview-light">
                <div class="preview-sidebar"></div>
                <div class="preview-content">
                  <div class="preview-bar"></div>
                  <div class="preview-cards">
                    <span></span><span></span>
                  </div>
                </div>
              </div>
              <div class="theme-option-meta">
                <strong>Light Mode</strong>
                <span>Crisp daylight surface with subtle Fluent contrast</span>
              </div>
            </button>
          </div>
        </section>

        <!-- Global Hotkey Configuration Card -->
        <section class="card settings-card">
          <div class="settings-card-header">
            <div>
              <h3 class="settings-section-title">Global Hotkey Configuration</h3>
              <p class="settings-section-desc">
                Toggle the Assistant window from anywhere in Windows. Default: <kbd class="kbd-inline">Ctrl + Shift + Space</kbd>
              </p>
            </div>
            <kbd id="settings-active-hotkey-badge" class="kbd-shortcut">${this.escapeHtml(displayHotkey)}</kbd>
          </div>

          <div class="hotkey-config-row">
            <div class="hotkey-input-wrapper">
              <label for="settings-hotkey-input" class="input-label">Shortcut Accelerator</label>
              <input
                type="text"
                id="settings-hotkey-input"
                class="input-text hotkey-input"
                value="${this.escapeHtml(displayHotkey)}"
                placeholder="e.g. Ctrl + Shift + Space or Ctrl + Alt + K"
              />
            </div>

            <div class="hotkey-actions">
              <button type="button" class="btn btn-secondary" id="settings-record-hotkey-btn">
                Record Keys
              </button>
              <button type="button" class="btn btn-primary" id="settings-save-hotkey-btn">
                Apply Shortcut
              </button>
              <button type="button" class="btn btn-ghost" id="settings-reset-hotkey-btn">
                Reset Default
              </button>
            </div>
          </div>
          <p id="settings-hotkey-hint" class="settings-hint">
            Tip: Click "Record Keys" and press a modifier (Ctrl, Alt, Shift) + any key, or type a combination and click "Apply Shortcut". If a conflict occurs, the previous working shortcut is automatically restored.
          </p>
        </section>

        <!-- Windows Startup & System Behavior -->
        <section class="card settings-card">
          <div class="settings-card-header">
            <div>
              <h3 class="settings-section-title">Windows Startup & Tray Behavior</h3>
              <p class="settings-section-desc">Configure automatic startup when you sign in to Windows.</p>
            </div>
          </div>

          <div class="setting-toggle-row">
            <div class="setting-toggle-info">
              <strong>Start with Windows</strong>
              <span>Automatically launch Desktop Assistant Bot in the background when Windows starts</span>
            </div>
            <label class="switch" for="settings-startup-checkbox">
              <input
                type="checkbox"
                id="settings-startup-checkbox"
                ${settings.start_with_windows ? 'checked' : ''}
              />
              <span class="slider"></span>
            </label>
          </div>

          <div class="setting-toggle-row">
            <div class="setting-toggle-info">
              <strong>Minimize to System Tray on Close</strong>
              <span>Clicking the window close button (X) keeps the assistant running in the Windows System Tray</span>
            </div>
            <span class="badge badge-offline">Always Active</span>
          </div>
        </section>

        <!-- Offline Mode & Local SQLite Database Info -->
        <section class="card settings-card">
          <div class="settings-card-header">
            <div>
              <h3 class="settings-section-title">Offline Mode & Local SQLite Storage</h3>
              <p class="settings-section-desc">All preferences are stored locally on your machine using better-sqlite3.</p>
            </div>
            <span class="badge badge-offline">100% Offline • v${this.escapeHtml(appVersion)}</span>
          </div>

          <div class="info-kv-grid">
            <div class="info-kv-item">
              <span class="info-kv-label">Application Version</span>
              <strong class="info-kv-val">v${this.escapeHtml(appVersion)} (Phase 1)</strong>
            </div>
            <div class="info-kv-item">
              <span class="info-kv-label">Network Policy</span>
              <strong class="info-kv-val">Strict Offline (No Cloud, No AI, No Telemetry)</strong>
            </div>
            <div class="info-kv-item info-kv-wide">
              <span class="info-kv-label">SQLite Database File Path</span>
              <code class="path-code">${this.escapeHtml(systemInfo.databasePath)}</code>
            </div>
          </div>

          <div class="sqlite-table-wrapper">
            <h4 class="subtable-title">Live SQLite <code>settings</code> Table Records</h4>
            <table class="sqlite-table">
              <thead>
                <tr>
                  <th>id</th>
                  <th>key</th>
                  <th>value</th>
                  <th>updated_at (UTC)</th>
                </tr>
              </thead>
              <tbody id="settings-sqlite-tbody">
                ${this.renderSqliteRows(settingsRows)}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    `;

    this.bindEvents();
  }

  public renderSqliteRows(rows: SettingRow[]): string {
    if (!rows || rows.length === 0) {
      return `<tr><td colspan="4">No records found.</td></tr>`;
    }
    return rows
      .map(
        (r) => `
        <tr>
          <td>${r.id}</td>
          <td><code>${this.escapeHtml(r.key)}</code></td>
          <td><strong>${this.escapeHtml(r.value)}</strong></td>
          <td>${this.escapeHtml(r.updated_at)}</td>
        </tr>
      `
      )
      .join('');
  }

  public updateSqliteTable(rows: SettingRow[]): void {
    const tbody = this.container.querySelector('#settings-sqlite-tbody');
    if (tbody) {
      tbody.innerHTML = this.renderSqliteRows(rows);
    }
  }

  public updateThemeSelectionUI(theme: ThemeMode): void {
    const cards = this.container.querySelectorAll<HTMLButtonElement>('[data-theme-choice]');
    cards.forEach((card) => {
      const choice = card.getAttribute('data-theme-choice');
      card.classList.toggle('selected', choice === theme);
    });
  }

  public updateHotkeyUI(displayHotkey: string): void {
    const badge = this.container.querySelector('#settings-active-hotkey-badge');
    if (badge) {
      badge.textContent = displayHotkey;
    }
    const input = this.container.querySelector<HTMLInputElement>('#settings-hotkey-input');
    if (input) {
      input.value = displayHotkey;
    }
  }

  private bindEvents(): void {
    const themeCards = this.container.querySelectorAll<HTMLButtonElement>('[data-theme-choice]');
    themeCards.forEach((card) => {
      card.addEventListener('click', () => {
        const theme = card.getAttribute('data-theme-choice') as ThemeMode | null;
        if (theme === 'dark' || theme === 'light') {
          this.callbacks.onThemeChange(theme);
        }
      });
    });

    const recordBtn = this.container.querySelector<HTMLButtonElement>('#settings-record-hotkey-btn');
    const saveBtn = this.container.querySelector<HTMLButtonElement>('#settings-save-hotkey-btn');
    const resetBtn = this.container.querySelector<HTMLButtonElement>('#settings-reset-hotkey-btn');
    const hotkeyInput = this.container.querySelector<HTMLInputElement>('#settings-hotkey-input');

    recordBtn?.addEventListener('click', () => {
      if (this.isRecordingHotkey) {
        this.cleanupRecorder();
      } else {
        this.startRecordingHotkey();
      }
    });

    saveBtn?.addEventListener('click', () => {
      this.cleanupRecorder();
      if (hotkeyInput) {
        this.callbacks.onUpdateHotkey(hotkeyInput.value);
      }
    });

    resetBtn?.addEventListener('click', () => {
      this.cleanupRecorder();
      this.callbacks.onResetHotkey();
    });

    const startupCheckbox = this.container.querySelector<HTMLInputElement>('#settings-startup-checkbox');
    startupCheckbox?.addEventListener('change', () => {
      this.callbacks.onToggleStartWithWindows(startupCheckbox.checked);
    });
  }

  private startRecordingHotkey(): void {
    const recordBtn = this.container.querySelector<HTMLButtonElement>('#settings-record-hotkey-btn');
    const hotkeyInput = this.container.querySelector<HTMLInputElement>('#settings-hotkey-input');
    const hint = this.container.querySelector<HTMLElement>('#settings-hotkey-hint');

    this.isRecordingHotkey = true;
    if (recordBtn) {
      recordBtn.textContent = 'Stop Recording';
      recordBtn.classList.add('recording-active');
    }
    if (hotkeyInput) {
      hotkeyInput.focus();
      hotkeyInput.placeholder = 'Press modifier + key now...';
    }
    if (hint) {
      hint.textContent = 'Listening for key combination... Press Escape to cancel.';
    }

    this.keydownHandler = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === 'Escape') {
        this.cleanupRecorder();
        return;
      }

      const parts: string[] = [];
      if (event.ctrlKey || event.metaKey) parts.push('Ctrl');
      if (event.altKey) parts.push('Alt');
      if (event.shiftKey) parts.push('Shift');

      const ignoredModifierKeys = new Set(['Control', 'Shift', 'Alt', 'Meta']);
      if (!ignoredModifierKeys.has(event.key)) {
        let keyName = event.key;
        if (event.code === 'Space' || keyName === ' ') {
          keyName = 'Space';
        } else if (keyName.length === 1) {
          keyName = keyName.toUpperCase();
        } else if (keyName.startsWith('Arrow')) {
          keyName = keyName.replace('Arrow', '');
        }
        parts.push(keyName);

        const combo = parts.join(' + ');
        if (hotkeyInput) {
          hotkeyInput.value = combo;
        }
        this.cleanupRecorder();
      } else if (hotkeyInput && parts.length > 0) {
        hotkeyInput.value = `${parts.join(' + ')} + ...`;
      }
    };

    window.addEventListener('keydown', this.keydownHandler, true);
  }

  private cleanupRecorder(): void {
    if (this.keydownHandler) {
      window.removeEventListener('keydown', this.keydownHandler, true);
      this.keydownHandler = null;
    }
    this.isRecordingHotkey = false;
    const recordBtn = this.container.querySelector<HTMLButtonElement>('#settings-record-hotkey-btn');
    if (recordBtn) {
      recordBtn.textContent = 'Record Keys';
      recordBtn.classList.remove('recording-active');
    }
    const hint = this.container.querySelector<HTMLElement>('#settings-hotkey-hint');
    if (hint) {
      hint.textContent =
        'Tip: Click "Record Keys" and press a modifier (Ctrl, Alt, Shift) + any key, or type a combination and click "Apply Shortcut". If a conflict occurs, the previous working shortcut is automatically restored.';
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
