import { confirmDialog } from '../../components/confirm-dialog.js';
import { toast } from '../../components/toast.js';
import { ipcService } from '../../services/ipc.js';
import {
  LeapMonthPolicy,
  LunarReminderRow,
  RecurrenceType,
  ReminderHistoryRow,
  ReminderRow
} from '../../types.js';

export type ReminderTab = 'solar' | 'lunar' | 'history';

export class RemindersPage {
  private readonly container: HTMLElement;
  private readonly onDataChanged?: () => void;

  private reminders: ReminderRow[] = [];
  private lunarReminders: LunarReminderRow[] = [];
  private history: ReminderHistoryRow[] = [];
  private activeTab: ReminderTab = 'solar';
  private editingSolarId: number | null = null;
  private editingLunarId: number | null = null;
  private highlightedKey: string | null = null;

  constructor(container: HTMLElement, onDataChanged?: () => void) {
    this.container = container;
    this.onDataChanged = onDataChanged;
  }

  public setData(
    reminders: ReminderRow[],
    lunarReminders: LunarReminderRow[],
    history: ReminderHistoryRow[]
  ): void {
    this.reminders = reminders;
    this.lunarReminders = lunarReminders;
    this.history = history;
    this.render();
  }

  public async refresh(): Promise<void> {
    const data = await ipcService.getRemindersData();
    this.reminders = data.reminders;
    this.lunarReminders = data.lunarReminders;
    this.history = data.history;
    this.render();
    this.onDataChanged?.();
  }

  public async highlightReminder(source: 'solar' | 'lunar', id: number): Promise<void> {
    this.activeTab = source;
    this.highlightedKey = `${source}:${id}`;
    await this.refresh();
  }

  public openCreateLunarReminderWithDate(lunarDay: number, lunarMonth: number): void {
    this.activeTab = 'lunar';
    this.render();
    this.openLunarModal(null, lunarDay, lunarMonth);
  }

  public render(): void {
    const activeSolarCount = this.reminders.filter((r) => r.is_enabled && !r.is_completed).length;
    const completedSolarCount = this.reminders.filter((r) => r.is_completed).length;
    const activeLunarCount = this.lunarReminders.filter((r) => r.is_enabled).length;

    this.container.innerHTML = `
      <div class="module-page reminders-page">
        <!-- Summary Strip -->
        <section class="todo-stats-grid">
          <div class="card stat-box">
            <span class="stat-box-label">Upcoming Solar Reminders</span>
            <strong id="reminder-stat-upcoming" class="stat-box-value text-blue">${activeSolarCount}</strong>
          </div>
          <div class="card stat-box">
            <span class="stat-box-label">Completed Reminders</span>
            <strong id="reminder-stat-completed" class="stat-box-value text-emerald">${completedSolarCount}</strong>
          </div>
          <div class="card stat-box">
            <span class="stat-box-label">Active Lunar Reminders</span>
            <strong id="reminder-stat-lunar" class="stat-box-value text-purple">${activeLunarCount}</strong>
          </div>
          <div class="card stat-box">
            <span class="stat-box-label">Notification History</span>
            <strong id="reminder-stat-history" class="stat-box-value">${this.history.length}</strong>
          </div>
        </section>

        <!-- Toolbar & Sub-tabs -->
        <section class="card launcher-toolbar">
          <div class="filter-tabs" role="tablist">
            <button
              type="button"
              class="filter-tab ${this.activeTab === 'solar' ? 'active' : ''}"
              data-rem-tab="solar"
            >
              Solar Reminders (${this.reminders.length})
            </button>
            <button
              type="button"
              class="filter-tab ${this.activeTab === 'lunar' ? 'active' : ''}"
              data-rem-tab="lunar"
            >
              Lunar Reminders • Lịch Âm (${this.lunarReminders.length})
            </button>
            <button
              type="button"
              class="filter-tab ${this.activeTab === 'history' ? 'active' : ''}"
              data-rem-tab="history"
            >
              Notification History (${this.history.length})
            </button>
          </div>

          <div class="toolbar-actions-group">
            <button type="button" id="rem-add-solar-btn" class="btn btn-primary btn-sm">
              + Add Solar Reminder
            </button>
            <button type="button" id="rem-add-lunar-btn" class="btn btn-secondary btn-sm">
              + Add Lunar Reminder
            </button>
          </div>
        </section>

        <!-- Active Tab Content -->
        <section class="reminders-tab-content">
          ${this.renderTabContent()}
        </section>

        <!-- Solar Reminder Modal -->
        <div id="solar-reminder-modal" class="modal-backdrop hidden" role="dialog" aria-modal="true">
          <div class="modal-dialog card">
            <div class="modal-header">
              <h3 id="solar-modal-title">Add Reminder</h3>
              <button type="button" id="solar-modal-close" class="btn-icon">&times;</button>
            </div>
            <form id="solar-reminder-form" class="modal-body form-stack">
              <div class="form-field">
                <label for="solar-rem-title" class="input-label">Reminder Title *</label>
                <input type="text" id="solar-rem-title" class="input-text" required placeholder="e.g. Standup meeting, Submit report..." />
              </div>

              <div class="form-field">
                <label for="solar-rem-desc" class="input-label">Description</label>
                <textarea id="solar-rem-desc" class="input-textarea" rows="2" placeholder="Optional notification details..."></textarea>
              </div>

              <div class="form-row-2">
                <div class="form-field">
                  <label for="solar-rem-trigger" class="input-label">Trigger Date & Time *</label>
                  <input type="datetime-local" id="solar-rem-trigger" class="input-text" required />
                </div>

                <div class="form-field">
                  <label for="solar-rem-recurrence" class="input-label">Recurrence</label>
                  <select id="solar-rem-recurrence" class="select-input">
                    <option value="none">None (One-time)</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Yearly</option>
                  </select>
                </div>
              </div>

              <div class="modal-footer-actions">
                <button type="button" id="solar-modal-cancel" class="btn btn-ghost">Cancel</button>
                <button type="submit" class="btn btn-primary">Save Reminder</button>
              </div>
            </form>
          </div>
        </div>

        <!-- Lunar Reminder Modal -->
        <div id="lunar-reminder-modal" class="modal-backdrop hidden" role="dialog" aria-modal="true">
          <div class="modal-dialog card">
            <div class="modal-header">
              <h3 id="lunar-modal-title">Add Yearly Lunar Reminder (Nhắc Lịch Âm)</h3>
              <button type="button" id="lunar-modal-close" class="btn-icon">&times;</button>
            </div>
            <form id="lunar-reminder-form" class="modal-body form-stack">
              <div class="form-field">
                <label for="lunar-rem-title" class="input-label">Title *</label>
                <input type="text" id="lunar-rem-title" class="input-text" required placeholder="e.g. Rằm hàng năm, Giỗ gia tiên, Tết Đoan Ngọ..." />
              </div>

              <div class="form-field">
                <label for="lunar-rem-desc" class="input-label">Description</label>
                <textarea id="lunar-rem-desc" class="input-textarea" rows="2" placeholder="Optional notes..."></textarea>
              </div>

              <div class="form-row-3">
                <div class="form-field">
                  <label for="lunar-rem-day" class="input-label">Lunar Day (1–30)</label>
                  <input type="number" id="lunar-rem-day" class="input-text" min="1" max="30" value="1" required />
                </div>

                <div class="form-field">
                  <label for="lunar-rem-month" class="input-label">Lunar Month (1–12)</label>
                  <input type="number" id="lunar-rem-month" class="input-text" min="1" max="12" value="1" required />
                </div>

                <div class="form-field">
                  <label for="lunar-rem-time" class="input-label">Notification Time</label>
                  <input type="time" id="lunar-rem-time" class="input-text" value="08:00" required />
                </div>
              </div>

              <div class="form-field">
                <label for="lunar-rem-policy" class="input-label">Leap Lunar Month Policy (Tháng Nhuận)</label>
                <select id="lunar-rem-policy" class="select-input">
                  <option value="regular_only">Regular Lunar Month Only (Skip Leap Month)</option>
                  <option value="leap_only">Prefer Leap Month When Present (Fallback Regular)</option>
                  <option value="both">Trigger in Both Regular & Leap Month</option>
                </select>
              </div>

              <div class="modal-footer-actions">
                <button type="button" id="lunar-modal-cancel" class="btn btn-ghost">Cancel</button>
                <button type="submit" class="btn btn-primary">Save Lunar Reminder</button>
              </div>
            </form>
          </div>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  private renderTabContent(): string {
    if (this.activeTab === 'solar') {
      return this.renderSolarRemindersList();
    }
    if (this.activeTab === 'lunar') {
      return this.renderLunarRemindersList();
    }
    return this.renderHistoryList();
  }

  private renderSolarRemindersList(): string {
    if (this.reminders.length === 0) {
      return `
        <div class="card empty-state">
          <h4>No Solar Reminders Configured</h4>
          <p>Create one-time or recurring desktop reminders. They continue working in the System Tray.</p>
        </div>
      `;
    }

    return `
      <div class="todo-list-container">
        ${this.reminders
          .map((r) => {
            const isHighlighted = this.highlightedKey === `solar:${r.id}`;
            const isDone = Boolean(r.is_completed);
            return `
              <div class="card task-item-card ${isDone ? 'task-done' : ''} ${
                isHighlighted ? 'reminder-highlight' : ''
              }">
                <div class="task-check-col">
                  <input
                    type="checkbox"
                    class="task-complete-checkbox"
                    data-solar-complete="${r.id}"
                    ${isDone ? 'checked' : ''}
                    title="Mark reminder as completed"
                  />
                </div>

                <div class="task-main-col">
                  <div class="task-header-row">
                    <h4 class="task-title ${isDone ? 'strike' : ''}">${this.escapeHtml(r.title)}</h4>
                    <div class="task-badges">
                      <span class="badge badge-accent">
                        ${this.formatRecurrence(r.recurrence_type)}
                      </span>
                      <span class="badge ${r.is_enabled ? 'badge-offline' : 'badge-neutral'}">
                        ${r.is_enabled ? 'Enabled' : 'Disabled'}
                      </span>
                      ${isDone ? `<span class="badge status-badge-done">Completed</span>` : ''}
                    </div>
                  </div>

                  ${
                    r.description
                      ? `<p class="task-desc">${this.escapeHtml(r.description)}</p>`
                      : ''
                  }

                  <div class="task-meta-row">
                    <span class="task-meta-item">
                      Scheduled: <strong>${this.escapeHtml(r.trigger_at.replace('T', ' '))}</strong>
                    </span>
                    ${
                      r.last_notified_at
                        ? `<span class="task-meta-item">Last Notified: ${this.escapeHtml(
                            r.last_notified_at
                          )}</span>`
                        : ''
                    }
                  </div>
                </div>

                <div class="task-actions-col">
                  <label class="switch" title="Enable or disable reminder">
                    <input
                      type="checkbox"
                      data-solar-enable="${r.id}"
                      ${r.is_enabled ? 'checked' : ''}
                    />
                    <span class="slider"></span>
                  </label>
                  <button type="button" class="btn btn-secondary btn-sm" data-solar-edit="${r.id}">
                    Edit
                  </button>
                  <button type="button" class="btn btn-danger-ghost btn-sm" data-solar-delete="${r.id}">
                    Delete
                  </button>
                </div>
              </div>
            `;
          })
          .join('')}
      </div>
    `;
  }

  private renderLunarRemindersList(): string {
    if (this.lunarReminders.length === 0) {
      return `
        <div class="card empty-state">
          <h4>No Lunar Reminders Configured</h4>
          <p>Create yearly Vietnamese Lunar Calendar reminders with explicit leap-month handling.</p>
        </div>
      `;
    }

    const policyLabels: Record<LeapMonthPolicy, string> = {
      regular_only: 'Regular Month Only',
      leap_only: 'Leap Month Preferred',
      both: 'Both Regular & Leap'
    };

    return `
      <div class="todo-list-container">
        ${this.lunarReminders
          .map((lr) => {
            const isHighlighted = this.highlightedKey === `lunar:${lr.id}`;
            return `
              <div class="card task-item-card ${isHighlighted ? 'reminder-highlight' : ''}">
                <div class="task-main-col">
                  <div class="task-header-row">
                    <h4 class="task-title">
                      Ngày ${lr.lunar_day} Tháng ${lr.lunar_month} Âm lịch — ${this.escapeHtml(
                        lr.title
                      )}
                    </h4>
                    <div class="task-badges">
                      <span class="badge badge-accent">Yearly Lunar</span>
                      <span class="badge badge-neutral">${
                        policyLabels[lr.leap_month_policy]
                      }</span>
                      <span class="badge ${
                        lr.is_enabled ? 'badge-offline' : 'badge-neutral'
                      }">
                        ${lr.is_enabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </div>
                  </div>

                  ${
                    lr.description
                      ? `<p class="task-desc">${this.escapeHtml(lr.description)}</p>`
                      : ''
                  }

                  <div class="task-meta-row">
                    <span class="task-meta-item text-emerald">
                      Next Solar Occurrence: <strong>${this.escapeHtml(
                        lr.next_solar_date
                      )} at ${this.escapeHtml(lr.trigger_time)}</strong>
                      ${lr.next_is_leap ? '(Leap Month)' : ''}
                    </span>
                  </div>
                </div>

                <div class="task-actions-col">
                  <label class="switch" title="Enable or disable lunar reminder">
                    <input
                      type="checkbox"
                      data-lunar-enable="${lr.id}"
                      ${lr.is_enabled ? 'checked' : ''}
                    />
                    <span class="slider"></span>
                  </label>
                  <button type="button" class="btn btn-secondary btn-sm" data-lunar-edit="${lr.id}">
                    Edit
                  </button>
                  <button type="button" class="btn btn-danger-ghost btn-sm" data-lunar-delete="${
                    lr.id
                  }">
                    Delete
                  </button>
                </div>
              </div>
            `;
          })
          .join('')}
      </div>
    `;
  }

  private renderHistoryList(): string {
    if (this.history.length === 0) {
      return `
        <div class="card empty-state">
          <h4>No Notification History Yet</h4>
          <p>Triggered and startup-recovered reminders are logged here automatically.</p>
        </div>
      `;
    }

    return `
      <div class="card sqlite-table-wrapper" style="padding: 18px;">
        <table class="sqlite-table">
          <thead>
            <tr>
              <th>Type</th>
              <th>Title</th>
              <th>Scheduled For</th>
              <th>Notified At</th>
              <th>Delivery Status</th>
            </tr>
          </thead>
          <tbody>
            ${this.history
              .map(
                (h) => `
              <tr>
                <td><span class="badge badge-neutral">${h.reminder_source.toUpperCase()}</span></td>
                <td><strong>${this.escapeHtml(h.title)}</strong></td>
                <td><code>${this.escapeHtml(h.scheduled_for.replace('T', ' '))}</code></td>
                <td><code>${this.escapeHtml(h.notified_at)}</code></td>
                <td>
                  ${
                    h.was_missed
                      ? `<span class="badge badge-muted">Recovered After Restart</span>`
                      : `<span class="badge badge-offline">Delivered On Time</span>`
                  }
                </td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  private bindEvents(): void {
    const tabBtns = this.container.querySelectorAll<HTMLButtonElement>('[data-rem-tab]');
    tabBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-rem-tab') as ReminderTab | null;
        if (tab) {
          this.activeTab = tab;
          this.render();
        }
      });
    });

    this.container
      .querySelector('#rem-add-solar-btn')
      ?.addEventListener('click', () => this.openSolarModal(null));
    this.container
      .querySelector('#rem-add-lunar-btn')
      ?.addEventListener('click', () => this.openLunarModal(null));

    this.container
      .querySelector('#solar-modal-close')
      ?.addEventListener('click', () => this.closeSolarModal());
    this.container
      .querySelector('#solar-modal-cancel')
      ?.addEventListener('click', () => this.closeSolarModal());

    this.container
      .querySelector('#lunar-modal-close')
      ?.addEventListener('click', () => this.closeLunarModal());
    this.container
      .querySelector('#lunar-modal-cancel')
      ?.addEventListener('click', () => this.closeLunarModal());

    const solarForm = this.container.querySelector<HTMLFormElement>('#solar-reminder-form');
    solarForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.handleSaveSolarForm();
    });

    const lunarForm = this.container.querySelector<HTMLFormElement>('#lunar-reminder-form');
    lunarForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.handleSaveLunarForm();
    });

    // Solar list item bindings
    this.container
      .querySelectorAll<HTMLInputElement>('[data-solar-complete]')
      .forEach((cb) => {
        cb.addEventListener('change', async () => {
          const id = Number(cb.getAttribute('data-solar-complete'));
          const res = await ipcService.updateReminder(id, { is_completed: cb.checked });
          if (res.success) {
            toast.show(
              cb.checked ? 'Reminder marked completed.' : 'Reminder marked active.',
              'success'
            );
            await this.refresh();
          }
        });
      });

    this.container
      .querySelectorAll<HTMLInputElement>('[data-solar-enable]')
      .forEach((cb) => {
        cb.addEventListener('change', async () => {
          const id = Number(cb.getAttribute('data-solar-enable'));
          const res = await ipcService.updateReminder(id, { is_enabled: cb.checked });
          if (res.success) {
            toast.show(
              cb.checked ? 'Reminder enabled.' : 'Reminder disabled.',
              'info'
            );
            await this.refresh();
          }
        });
      });

    this.container
      .querySelectorAll<HTMLButtonElement>('[data-solar-edit]')
      .forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = Number(btn.getAttribute('data-solar-edit'));
          const r = this.reminders.find((item) => item.id === id) || null;
          if (r) this.openSolarModal(r);
        });
      });

    this.container
      .querySelectorAll<HTMLButtonElement>('[data-solar-delete]')
      .forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = Number(btn.getAttribute('data-solar-delete'));
          const r = this.reminders.find((item) => item.id === id);
          if (!r) return;
          const ok = await confirmDialog.ask({
            title: 'Delete Reminder',
            message: `Delete reminder "${r.title}"?`,
            confirmLabel: 'Delete'
          });
          if (ok) {
            await ipcService.deleteReminder(id);
            toast.show('Reminder deleted.', 'info');
            await this.refresh();
          }
        });
      });

    // Lunar list item bindings
    this.container
      .querySelectorAll<HTMLInputElement>('[data-lunar-enable]')
      .forEach((cb) => {
        cb.addEventListener('change', async () => {
          const id = Number(cb.getAttribute('data-lunar-enable'));
          const res = await ipcService.updateLunarReminder(id, { is_enabled: cb.checked });
          if (res.success) {
            toast.show(
              cb.checked ? 'Lunar reminder enabled.' : 'Lunar reminder disabled.',
              'info'
            );
            await this.refresh();
          }
        });
      });

    this.container
      .querySelectorAll<HTMLButtonElement>('[data-lunar-edit]')
      .forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = Number(btn.getAttribute('data-lunar-edit'));
          const lr = this.lunarReminders.find((item) => item.id === id) || null;
          if (lr) this.openLunarModal(lr);
        });
      });

    this.container
      .querySelectorAll<HTMLButtonElement>('[data-lunar-delete]')
      .forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = Number(btn.getAttribute('data-lunar-delete'));
          const lr = this.lunarReminders.find((item) => item.id === id);
          if (!lr) return;
          const ok = await confirmDialog.ask({
            title: 'Delete Lunar Reminder',
            message: `Delete lunar reminder "${lr.title}"?`,
            confirmLabel: 'Delete'
          });
          if (ok) {
            await ipcService.deleteLunarReminder(id);
            toast.show('Lunar reminder deleted.', 'info');
            await this.refresh();
          }
        });
      });
  }

  private openSolarModal(reminder: ReminderRow | null): void {
    this.editingSolarId = reminder ? reminder.id : null;
    const modal = this.container.querySelector('#solar-reminder-modal');
    const titleEl = this.container.querySelector('#solar-modal-title');
    const titleInput = this.container.querySelector<HTMLInputElement>('#solar-rem-title');
    const descInput = this.container.querySelector<HTMLTextAreaElement>('#solar-rem-desc');
    const triggerInput = this.container.querySelector<HTMLInputElement>('#solar-rem-trigger');
    const recInput = this.container.querySelector<HTMLSelectElement>('#solar-rem-recurrence');

    if (titleEl) titleEl.textContent = reminder ? 'Edit Reminder' : 'Add Solar Reminder';
    if (titleInput) titleInput.value = reminder ? reminder.title : '';
    if (descInput) descInput.value = reminder ? reminder.description : '';
    if (triggerInput) {
      if (reminder) {
        triggerInput.value = reminder.trigger_at.slice(0, 16);
      } else {
        const soon = new Date(Date.now() + 3600000);
        const pad = (n: number) => String(n).padStart(2, '0');
        triggerInput.value = `${soon.getFullYear()}-${pad(soon.getMonth() + 1)}-${pad(
          soon.getDate()
        )}T${pad(soon.getHours())}:${pad(soon.getMinutes())}`;
      }
    }
    if (recInput) recInput.value = reminder ? reminder.recurrence_type : 'none';

    modal?.classList.remove('hidden');
    titleInput?.focus();
  }

  private closeSolarModal(): void {
    this.container.querySelector('#solar-reminder-modal')?.classList.add('hidden');
    this.editingSolarId = null;
  }

  private async handleSaveSolarForm(): Promise<void> {
    const titleInput = this.container.querySelector<HTMLInputElement>('#solar-rem-title');
    const descInput = this.container.querySelector<HTMLTextAreaElement>('#solar-rem-desc');
    const triggerInput = this.container.querySelector<HTMLInputElement>('#solar-rem-trigger');
    const recInput = this.container.querySelector<HTMLSelectElement>('#solar-rem-recurrence');

    const title = titleInput?.value.trim() || '';
    const triggerAt = triggerInput?.value || '';
    if (!title || !triggerAt) {
      toast.show('Title and trigger time are required.', 'error');
      return;
    }

    const payload = {
      title,
      description: descInput?.value.trim() || '',
      trigger_at: triggerAt,
      recurrence_type: (recInput?.value || 'none') as RecurrenceType
    };

    if (this.editingSolarId !== null) {
      const res = await ipcService.updateReminder(this.editingSolarId, payload);
      if (res.success) {
        toast.show('Reminder updated.', 'success');
        this.closeSolarModal();
        this.activeTab = 'solar';
        await this.refresh();
      } else {
        toast.show(res.message, 'error');
      }
    } else {
      const res = await ipcService.createReminder(payload);
      if (res.success) {
        toast.show('Reminder created.', 'success');
        this.closeSolarModal();
        this.activeTab = 'solar';
        await this.refresh();
      } else {
        toast.show(res.message, 'error');
      }
    }
  }

  private openLunarModal(
    lunarRem: LunarReminderRow | null,
    defaultDay = 1,
    defaultMonth = 1
  ): void {
    this.editingLunarId = lunarRem ? lunarRem.id : null;
    const modal = this.container.querySelector('#lunar-reminder-modal');
    const titleEl = this.container.querySelector('#lunar-modal-title');
    const titleInput = this.container.querySelector<HTMLInputElement>('#lunar-rem-title');
    const descInput = this.container.querySelector<HTMLTextAreaElement>('#lunar-rem-desc');
    const dayInput = this.container.querySelector<HTMLInputElement>('#lunar-rem-day');
    const monthInput = this.container.querySelector<HTMLInputElement>('#lunar-rem-month');
    const timeInput = this.container.querySelector<HTMLInputElement>('#lunar-rem-time');
    const policyInput = this.container.querySelector<HTMLSelectElement>('#lunar-rem-policy');

    if (titleEl) {
      titleEl.textContent = lunarRem
        ? 'Edit Lunar Reminder'
        : 'Add Yearly Lunar Reminder (Nhắc Lịch Âm)';
    }
    if (titleInput) titleInput.value = lunarRem ? lunarRem.title : '';
    if (descInput) descInput.value = lunarRem ? lunarRem.description : '';
    if (dayInput) dayInput.value = String(lunarRem ? lunarRem.lunar_day : defaultDay);
    if (monthInput) monthInput.value = String(lunarRem ? lunarRem.lunar_month : defaultMonth);
    if (timeInput) timeInput.value = lunarRem ? lunarRem.trigger_time : '08:00';
    if (policyInput) {
      policyInput.value = lunarRem ? lunarRem.leap_month_policy : 'regular_only';
    }

    modal?.classList.remove('hidden');
    titleInput?.focus();
  }

  private closeLunarModal(): void {
    this.container.querySelector('#lunar-reminder-modal')?.classList.add('hidden');
    this.editingLunarId = null;
  }

  private async handleSaveLunarForm(): Promise<void> {
    const titleInput = this.container.querySelector<HTMLInputElement>('#lunar-rem-title');
    const descInput = this.container.querySelector<HTMLTextAreaElement>('#lunar-rem-desc');
    const dayInput = this.container.querySelector<HTMLInputElement>('#lunar-rem-day');
    const monthInput = this.container.querySelector<HTMLInputElement>('#lunar-rem-month');
    const timeInput = this.container.querySelector<HTMLInputElement>('#lunar-rem-time');
    const policyInput = this.container.querySelector<HTMLSelectElement>('#lunar-rem-policy');

    const title = titleInput?.value.trim() || '';
    const lunarDay = Number(dayInput?.value || 1);
    const lunarMonth = Number(monthInput?.value || 1);

    if (!title || lunarDay < 1 || lunarDay > 30 || lunarMonth < 1 || lunarMonth > 12) {
      toast.show('Please enter a valid title, lunar day (1..30), and lunar month (1..12).', 'error');
      return;
    }

    const payload = {
      title,
      description: descInput?.value.trim() || '',
      lunar_day: lunarDay,
      lunar_month: lunarMonth,
      trigger_time: timeInput?.value || '08:00',
      leap_month_policy: (policyInput?.value || 'regular_only') as LeapMonthPolicy
    };

    if (this.editingLunarId !== null) {
      const res = await ipcService.updateLunarReminder(this.editingLunarId, payload);
      if (res.success) {
        toast.show('Lunar reminder updated.', 'success');
        this.closeLunarModal();
        this.activeTab = 'lunar';
        await this.refresh();
      } else {
        toast.show(res.message, 'error');
      }
    } else {
      const res = await ipcService.createLunarReminder(payload);
      if (res.success) {
        toast.show('Lunar reminder created.', 'success');
        this.closeLunarModal();
        this.activeTab = 'lunar';
        await this.refresh();
      } else {
        toast.show(res.message, 'error');
      }
    }
  }

  private formatRecurrence(rec: RecurrenceType): string {
    switch (rec) {
      case 'daily':
        return 'Repeats Daily';
      case 'weekly':
        return 'Repeats Weekly';
      case 'monthly':
        return 'Repeats Monthly';
      case 'yearly':
        return 'Repeats Yearly';
      default:
        return 'One-Time';
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
