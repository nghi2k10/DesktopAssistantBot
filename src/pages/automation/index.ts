import { confirmDialog } from '../../components/confirm-dialog.js';
import { toast } from '../../components/toast.js';
import { ipcService } from '../../services/ipc.js';
import {
  ActionType,
  AutomationActionLogRow,
  AutomationDashboardStats,
  AutomationExecutionRow,
  AutomationSettingsMap,
  AutomationWorkflow,
  ConditionGroup,
  ConditionOperator,
  ConditionRule,
  ConditionType,
  ExecutionPolicy,
  ExecutionStatus,
  FileWatchEventType,
  MissedSchedulePolicy,
  ScheduleFrequency,
  TriggerType,
  WorkflowActionStep,
  WorkflowImportPreview
} from '../../types.js';

export type AutomationSubTab =
  | 'dashboard'
  | 'workflows'
  | 'builder'
  | 'history'
  | 'settings';

const ACTION_TYPE_LABELS: Record<ActionType, string> = {
  open_application: 'Open Application (Trusted .exe)',
  open_folder: 'Open Folder in Explorer',
  open_url: 'Open URL in Default Browser',
  show_notification: 'Show Desktop Notification',
  create_todo: 'Todo: Create Task',
  update_todo_status: 'Todo: Update Task Status',
  complete_todo: 'Todo: Complete Task',
  create_note: 'Notes: Create Quick Note',
  update_note: 'Notes: Append / Update Note',
  pin_note: 'Notes: Pin / Unpin Note',
  create_reminder: 'Reminder: Create Reminder',
  enable_reminder: 'Reminder: Enable Reminder',
  disable_reminder: 'Reminder: Disable Reminder',
  copy_file: 'File: Copy File',
  move_file: 'File: Move File',
  rename_file: 'File: Rename File',
  create_folder: 'File: Create Folder',
  delay: 'Flow: Delay / Wait',
  stop_workflow: 'Flow: Stop Workflow',
  if_else: 'Flow: If / Else Branch'
};

const CONDITION_TYPE_LABELS: Record<ConditionType, string> = {
  time_hour: 'Current Hour (0-23)',
  time_weekday: 'Current Weekday (0=Sun..6=Sat)',
  time_date: 'Current Date (YYYY-MM-DD)',
  time_date_range: 'Date Within Range',
  file_exists: 'File / Folder Exists',
  file_not_exists: 'File / Folder Does Not Exist',
  file_extension: 'File Extension Matches',
  file_size: 'File Size (Bytes)',
  todo_incomplete_count: 'Todo: Incomplete Task Count',
  todo_overdue_count: 'Todo: Overdue Task Count',
  todo_completed: 'Todo: Specific Task Completed',
  workflow_enabled: 'Workflow: Is Enabled',
  workflow_last_status: 'Workflow: Last Execution Status',
  workflow_is_running: 'Workflow: Is Currently Running'
};

export class AutomationPage {
  private readonly container: HTMLElement;
  private readonly onDataChanged?: () => void;

  private activeTab: AutomationSubTab = 'dashboard';
  private workflows: AutomationWorkflow[] = [];
  private stats: AutomationDashboardStats = {
    totalAutomations: 0,
    enabledAutomations: 0,
    disabledAutomations: 0,
    runningAutomations: 0,
    successfulExecutions: 0,
    failedExecutions: 0,
    skippedExecutions: 0,
    cancelledExecutions: 0,
    nextScheduledWorkflow: null,
    pendingMissedApprovals: []
  };
  private recentExecutions: AutomationExecutionRow[] = [];
  private settings: AutomationSettingsMap = {
    engine_enabled: true,
    max_concurrent_workflows: 3,
    default_timeout_ms: 60000,
    default_error_policy: 'stop',
    missed_schedule_policy: 'run_once',
    history_retention_days: 30,
    notifications_enabled: true,
    file_watcher_debounce_ms: 600,
    trusted_app_paths: [
      'C:\\Windows\\System32\\notepad.exe',
      'C:\\Windows\\System32\\calc.exe',
      'C:\\Windows\\explorer.exe'
    ]
  };
  private runningExecutionIdsByWorkflow: Record<number, number[]> = {};

  // My Automations filter state
  private wfSearch = '';
  private wfTriggerFilter: 'all' | TriggerType = 'all';
  private wfStatusFilter: 'all' | 'enabled' | 'disabled' = 'all';

  // Execution History filter state
  private historyItems: AutomationExecutionRow[] = [];
  private historyTotal = 0;
  private historyFilterWorkflowId: number | undefined = undefined;
  private historyFilterStatus: 'all' | ExecutionStatus = 'all';
  private historyFilterDateFrom = '';
  private historyFilterDateTo = '';
  private historyFilterSearch = '';
  private historyPageOffset = 0;
  private readonly historyPageLimit = 30;

  // Execution Details Modal state
  private selectedExecutionDetail: {
    execution: AutomationExecutionRow;
    actionLogs: AutomationActionLogRow[];
  } | null = null;

  // Import / Export Modal state
  private importExportModalMode: 'closed' | 'export' | 'import' = 'closed';
  private exportJsonText = '';
  private importJsonText = '';
  private importPreviewResult: WorkflowImportPreview | null = null;

  // Builder state
  private builderId?: number;
  private builderName = '';
  private builderDescription = '';
  private builderEnabled = true;
  private builderTriggerType: TriggerType = 'schedule';
  private builderTriggerConfig: Record<string, unknown> = {
    frequency: 'daily',
    time: '08:00',
    weekdays: [1, 2, 3, 4, 5],
    dayOfMonth: 1,
    monthOfYear: 1,
    missedPolicy: 'run_once'
  };
  private builderConditionConfig: ConditionGroup = {
    operator: 'AND',
    conditions: []
  };
  private builderActions: WorkflowActionStep[] = [];
  private builderPolicy: ExecutionPolicy = {
    onError: 'stop',
    timeoutMs: 60000,
    maxRetries: 0,
    retryDelayMs: 1000,
    allowConcurrent: false
  };
  private builderValidationErrors: string[] = [];

  constructor(container: HTMLElement, onDataChanged?: () => void) {
    this.container = container;
    this.onDataChanged = onDataChanged;
  }

  public async refresh(): Promise<void> {
    try {
      const overview = await ipcService.getAutomationOverview();
      this.workflows = overview.workflows;
      this.stats = overview.stats;
      this.recentExecutions = overview.recentExecutions;
      this.settings = overview.settings;
      this.runningExecutionIdsByWorkflow = overview.runningExecutionIdsByWorkflow;

      if (this.activeTab === 'history') {
        await this.loadHistoryPage();
      } else {
        this.render();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.show(`Failed to load automation data: ${msg}`, 'error');
    }
  }

  public switchSubTab(tab: AutomationSubTab): void {
    this.activeTab = tab;
    if (tab === 'history') {
      void this.loadHistoryPage();
    } else {
      this.render();
    }
  }

  private async loadHistoryPage(): Promise<void> {
    try {
      const res = await ipcService.getAutomationExecutions({
        automationId: this.historyFilterWorkflowId,
        status: this.historyFilterStatus,
        dateFrom: this.historyFilterDateFrom || undefined,
        dateTo: this.historyFilterDateTo || undefined,
        search: this.historyFilterSearch || undefined,
        limit: this.historyPageLimit,
        offset: this.historyPageOffset
      });
      this.historyItems = res.items;
      this.historyTotal = res.total;
      this.render();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.show(`Failed to load execution history: ${msg}`, 'error');
    }
  }

  private resetBuilderForNew(): void {
    this.builderId = undefined;
    this.builderName = '';
    this.builderDescription = '';
    this.builderEnabled = true;
    this.builderTriggerType = 'schedule';
    this.builderTriggerConfig = {
      frequency: 'daily',
      time: '08:00',
      weekdays: [1, 2, 3, 4, 5],
      dayOfMonth: 1,
      monthOfYear: 1,
      missedPolicy: this.settings.missed_schedule_policy || 'run_once'
    };
    this.builderConditionConfig = {
      operator: 'AND',
      conditions: []
    };
    this.builderActions = [
      {
        id: `act_${Date.now()}_1`,
        type: 'show_notification',
        config: {
          title: 'Daily Automation',
          body: 'Your scheduled workflow has started!'
        },
        onError: 'inherit',
        maxRetries: 0
      }
    ];
    this.builderPolicy = {
      onError: this.settings.default_error_policy || 'stop',
      timeoutMs: this.settings.default_timeout_ms || 60000,
      maxRetries: 0,
      retryDelayMs: 1000,
      allowConcurrent: false
    };
    this.builderValidationErrors = [];
  }

  private loadWorkflowIntoBuilder(wf: AutomationWorkflow): void {
    this.builderId = wf.id;
    this.builderName = wf.name;
    this.builderDescription = wf.description;
    this.builderEnabled = wf.isEnabled;
    this.builderTriggerType = wf.triggerType;
    this.builderTriggerConfig = JSON.parse(JSON.stringify(wf.triggerConfig || {}));
    this.builderConditionConfig = JSON.parse(
      JSON.stringify(wf.conditionConfig || { operator: 'AND', conditions: [] })
    );
    this.builderActions = JSON.parse(JSON.stringify(wf.actions || []));
    this.builderPolicy = JSON.parse(JSON.stringify(wf.executionPolicy));
    this.builderValidationErrors = [];
  }

  private loadPresetTemplate(templateKey: string): void {
    this.resetBuilderForNew();
    if (templateKey === 'morning_routine') {
      this.builderName = 'Morning Productivity Routine';
      this.builderDescription =
        'Every weekday at 08:00, create daily planning todo, create a quick note, and notify.';
      this.builderTriggerType = 'schedule';
      this.builderTriggerConfig = {
        frequency: 'weekly',
        time: '08:00',
        weekdays: [1, 2, 3, 4, 5],
        missedPolicy: 'run_once'
      };
      this.builderConditionConfig = {
        operator: 'AND',
        conditions: [
          {
            id: `cond_${Date.now()}`,
            type: 'todo_incomplete_count',
            operator: 'less_than',
            value: '50'
          }
        ]
      };
      this.builderActions = [
        {
          id: `act_${Date.now()}_1`,
          type: 'create_todo',
          config: {
            title: 'Review daily priorities & calendar',
            description: 'Auto-created by Morning Productivity Routine',
            priority: 'high',
            status: 'todo',
            category: 'Work',
            dueOffsetMinutes: 240
          },
          onError: 'inherit'
        },
        {
          id: `act_${Date.now()}_2`,
          type: 'create_note',
          config: {
            title: 'Daily Scratchpad',
            content: 'Key focus items for today:\n- ',
            color: 'blue',
            isPinned: true
          },
          onError: 'inherit'
        },
        {
          id: `act_${Date.now()}_3`,
          type: 'show_notification',
          config: {
            title: 'Good Morning!',
            body: 'Daily task and scratchpad note are ready.'
          },
          onError: 'inherit'
        }
      ];
    } else if (templateKey === 'hotkey_snapshot') {
      this.builderName = 'Quick Focus Snapshot (Hotkey)';
      this.builderDescription =
        'Press Ctrl+Alt+T to create an urgent follow-up task and reminder.';
      this.builderTriggerType = 'hotkey';
      this.builderTriggerConfig = {
        shortcut: 'CommandOrControl+Alt+T'
      };
      this.builderActions = [
        {
          id: `act_${Date.now()}_1`,
          type: 'create_todo',
          config: {
            title: 'Quick Follow-up Item',
            description: 'Triggered via global workflow hotkey',
            priority: 'high',
            status: 'in_progress',
            category: 'Urgent',
            dueOffsetMinutes: 120
          },
          onError: 'inherit'
        },
        {
          id: `act_${Date.now()}_2`,
          type: 'create_reminder',
          config: {
            title: 'Check Quick Follow-up Item',
            description: 'Scheduled 30 mins after hotkey trigger',
            offsetMinutes: 30,
            recurrence: 'none'
          },
          onError: 'inherit'
        }
      ];
    } else if (templateKey === 'startup_briefing') {
      this.builderName = 'Startup Assistant Briefing';
      this.builderDescription =
        'Runs 5 seconds after Assistant starts to log session note and notify.';
      this.builderTriggerType = 'startup';
      this.builderTriggerConfig = {
        delaySeconds: 5,
        oncePerSession: true
      };
      this.builderActions = [
        {
          id: `act_${Date.now()}_1`,
          type: 'show_notification',
          config: {
            title: 'Desktop Assistant Bot Active',
            body: 'Offline automation engine is monitoring your workflows.'
          },
          onError: 'inherit'
        }
      ];
    }
    this.activeTab = 'builder';
    this.render();
    toast.show('Loaded workflow template into Builder.', 'info');
  }

  public render(): void {
    const engineBadge = this.settings.engine_enabled
      ? `<span class="badge badge-emerald">Engine Active</span>`
      : `<span class="badge badge-amber">Engine Paused</span>`;

    this.container.innerHTML = `
      <div class="automation-module">
        <!-- Sub-navigation bar -->
        <div class="automation-subnav card">
          <div class="automation-subnav-tabs" role="tablist">
            <button type="button" class="subnav-tab ${
              this.activeTab === 'dashboard' ? 'active' : ''
            }" data-auto-tab="dashboard">
              Dashboard
            </button>
            <button type="button" class="subnav-tab ${
              this.activeTab === 'workflows' ? 'active' : ''
            }" data-auto-tab="workflows">
              My Automations (${this.stats.totalAutomations})
            </button>
            <button type="button" class="subnav-tab ${
              this.activeTab === 'builder' ? 'active' : ''
            }" data-auto-tab="builder">
              ${this.builderId ? `Edit Workflow #${this.builderId}` : '+ Automation Builder'}
            </button>
            <button type="button" class="subnav-tab ${
              this.activeTab === 'history' ? 'active' : ''
            }" data-auto-tab="history">
              Execution History
            </button>
            <button type="button" class="subnav-tab ${
              this.activeTab === 'settings' ? 'active' : ''
            }" data-auto-tab="settings">
              Automation Settings
            </button>
          </div>
          <div class="automation-subnav-status">
            ${engineBadge}
            <button type="button" id="auto-new-wf-btn" class="btn btn-primary btn-sm">
              + New Automation
            </button>
          </div>
        </div>

        <!-- Active Sub-View Content -->
        <div class="automation-subview">
          ${this.renderActiveSubView()}
        </div>

        ${this.renderExecutionDetailsModal()}
        ${this.renderImportExportModal()}
      </div>
    `;

    this.bindEvents();
  }

  private renderActiveSubView(): string {
    switch (this.activeTab) {
      case 'dashboard':
        return this.renderDashboardView();
      case 'workflows':
        return this.renderWorkflowsListView();
      case 'builder':
        return this.renderBuilderView();
      case 'history':
        return this.renderHistoryView();
      case 'settings':
        return this.renderSettingsView();
    }
  }

  // ==========================================================================
  // 1. AUTOMATION DASHBOARD VIEW
  // ==========================================================================
  private renderDashboardView(): string {
    const nextSched = this.stats.nextScheduledWorkflow
      ? `<strong>${this.escapeHtml(
          this.stats.nextScheduledWorkflow.name
        )}</strong> at <code>${this.escapeHtml(
          this.formatDateTime(this.stats.nextScheduledWorkflow.nextExecutionAt)
        )}</code>`
      : 'No upcoming scheduled workflow';

    const pendingMissedHtml =
      this.stats.pendingMissedApprovals.length > 0
        ? `
          <div class="card automation-missed-alert">
            <div class="card-header">
              <h3 class="card-title text-amber">Missed Scheduled Workflows Require Confirmation</h3>
            </div>
            <div class="missed-list">
              ${this.stats.pendingMissedApprovals
                .map(
                  (m) => `
                  <div class="missed-item">
                    <div>
                      <strong>${this.escapeHtml(m.workflowName)}</strong>
                      <span class="text-muted"> — Scheduled for ${this.escapeHtml(
                        this.formatDateTime(m.missedScheduledAt)
                      )}</span>
                    </div>
                    <div class="btn-group">
                      <button type="button" class="btn btn-primary btn-xs" data-approve-missed="${
                        m.automationId
                      }">Run Now</button>
                      <button type="button" class="btn btn-ghost btn-xs" data-dismiss-missed="${
                        m.automationId
                      }">Skip & Dismiss</button>
                    </div>
                  </div>
                `
                )
                .join('')}
            </div>
          </div>
        `
        : '';

    return `
      ${pendingMissedHtml}

      <!-- KPI Stat Cards -->
      <div class="automation-stats-grid">
        <div class="card stat-card">
          <span class="stat-label">Total Automations</span>
          <strong class="stat-value" id="auto-stat-total">${this.stats.totalAutomations}</strong>
          <span class="stat-meta">${this.stats.enabledAutomations} enabled • ${
      this.stats.disabledAutomations
    } disabled</span>
        </div>
        <div class="card stat-card">
          <span class="stat-label">Currently Running</span>
          <strong class="stat-value text-blue" id="auto-stat-running">${
            this.stats.runningAutomations
          }</strong>
          <span class="stat-meta">Max concurrent: ${
            this.settings.max_concurrent_workflows
          }</span>
        </div>
        <div class="card stat-card">
          <span class="stat-label">Successful Runs</span>
          <strong class="stat-value text-emerald" id="auto-stat-success">${
            this.stats.successfulExecutions
          }</strong>
          <span class="stat-meta">${this.stats.skippedExecutions} skipped</span>
        </div>
        <div class="card stat-card">
          <span class="stat-label">Failed / Cancelled</span>
          <strong class="stat-value text-danger" id="auto-stat-failed">${
            this.stats.failedExecutions
          }</strong>
          <span class="stat-meta">${this.stats.cancelledExecutions} cancelled</span>
        </div>
      </div>

      <!-- Next Scheduled & Quick Templates Banner -->
      <div class="card automation-next-banner">
        <div class="next-banner-info">
          <span class="badge badge-blue">Next Scheduled</span>
          <span>${nextSched}</span>
        </div>
        <div class="next-banner-actions">
          <button type="button" class="btn btn-secondary btn-xs" data-load-template="morning_routine">
            Template: Morning Routine
          </button>
          <button type="button" class="btn btn-secondary btn-xs" data-load-template="hotkey_snapshot">
            Template: Hotkey Snapshot
          </button>
          <button type="button" class="btn btn-ghost btn-xs" data-auto-tab="history">
            View Full History &rarr;
          </button>
        </div>
      </div>

      <div class="automation-dashboard-columns">
        <!-- Quick Workflows Control Card -->
        <div class="card">
          <div class="card-header">
            <div>
              <h3 class="card-title">Configured Workflows</h3>
              <p class="card-subtitle">Quick enable/disable, run now, or edit workflows</p>
            </div>
            <button type="button" class="btn btn-ghost btn-xs" data-auto-tab="workflows">
              Manage All
            </button>
          </div>
          ${
            this.workflows.length === 0
              ? `<div class="empty-state-box">
                  <p>No automation workflows created yet.</p>
                  <button type="button" class="btn btn-primary btn-sm" id="empty-create-wf-btn">+ Create First Automation</button>
                </div>`
              : `<div class="table-responsive">
                  <table class="data-table">
                    <thead>
                      <tr>
                        <th>Workflow</th>
                        <th>Trigger</th>
                        <th>Enabled</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${this.workflows
                        .slice(0, 8)
                        .map(
                          (wf) => `
                          <tr>
                            <td>
                              <strong>${this.escapeHtml(wf.name)}</strong>
                              <div class="text-xs text-muted">${wf.actions.length} step(s)</div>
                            </td>
                            <td>
                              <span class="badge badge-slate">${this.formatTriggerBadge(
                                wf
                              )}</span>
                            </td>
                            <td>
                              <input type="checkbox" class="wf-toggle-checkbox" data-toggle-wf="${
                                wf.id
                              }" ${wf.isEnabled ? 'checked' : ''} />
                            </td>
                            <td>
                              <div class="btn-group">
                                <button type="button" class="btn btn-primary btn-xs" data-run-wf="${
                                  wf.id
                                }">Run Now</button>
                                <button type="button" class="btn btn-ghost btn-xs" data-edit-wf="${
                                  wf.id
                                }">Edit</button>
                              </div>
                            </td>
                          </tr>
                        `
                        )
                        .join('')}
                    </tbody>
                  </table>
                </div>`
          }
        </div>

        <!-- Recent Execution History Card -->
        <div class="card">
          <div class="card-header">
            <div>
              <h3 class="card-title">Recent Execution History</h3>
              <p class="card-subtitle">Real-time execution results from SQLite</p>
            </div>
            <button type="button" class="btn btn-ghost btn-xs" data-auto-tab="history">
              All Logs
            </button>
          </div>
          ${
            this.recentExecutions.length === 0
              ? `<div class="empty-state-box"><p>No workflow executions recorded yet.</p></div>`
              : `<div class="table-responsive">
                  <table class="data-table">
                    <thead>
                      <tr>
                        <th>Workflow</th>
                        <th>Status</th>
                        <th>Time / Duration</th>
                        <th>Details</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${this.recentExecutions
                        .slice(0, 8)
                        .map(
                          (ex) => `
                          <tr>
                            <td>
                              <strong>${this.escapeHtml(ex.workflow_name)}</strong>
                              <div class="text-xs text-muted">${this.escapeHtml(
                                ex.trigger_type
                              )}</div>
                            </td>
                            <td>${this.renderStatusBadge(ex.status)}</td>
                            <td>
                              <div class="text-xs">${this.escapeHtml(
                                this.formatDateTime(ex.started_at)
                              )}</div>
                              <div class="text-xs text-muted">${ex.duration_ms} ms</div>
                            </td>
                            <td>
                              <div class="btn-group">
                                <button type="button" class="btn btn-ghost btn-xs" data-view-exec="${
                                  ex.id
                                }">Logs</button>
                                ${
                                  ex.status === 'running'
                                    ? `<button type="button" class="btn btn-danger btn-xs" data-cancel-exec="${ex.id}">Cancel</button>`
                                    : ex.status === 'failed'
                                    ? `<button type="button" class="btn btn-secondary btn-xs" data-retry-exec="${ex.id}">Retry</button>`
                                    : ''
                                }
                              </div>
                            </td>
                          </tr>
                        `
                        )
                        .join('')}
                    </tbody>
                  </table>
                </div>`
          }
        </div>
      </div>
    `;
  }

  // ==========================================================================
  // 2. MY AUTOMATIONS VIEW
  // ==========================================================================
  private renderWorkflowsListView(): string {
    const filtered = this.workflows.filter((wf) => {
      if (this.wfTriggerFilter !== 'all' && wf.triggerType !== this.wfTriggerFilter) {
        return false;
      }
      if (this.wfStatusFilter === 'enabled' && !wf.isEnabled) return false;
      if (this.wfStatusFilter === 'disabled' && wf.isEnabled) return false;
      if (this.wfSearch.trim()) {
        const q = this.wfSearch.trim().toLowerCase();
        if (
          !wf.name.toLowerCase().includes(q) &&
          !wf.description.toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });

    return `
      <div class="card">
        <div class="automation-toolbar">
          <div class="automation-filters">
            <input
              type="text"
              id="wf-search-input"
              class="form-input"
              placeholder="Search workflows..."
              value="${this.escapeHtml(this.wfSearch)}"
            />
            <select id="wf-trigger-filter" class="form-select">
              <option value="all" ${this.wfTriggerFilter === 'all' ? 'selected' : ''}>All Triggers</option>
              <option value="schedule" ${this.wfTriggerFilter === 'schedule' ? 'selected' : ''}>Schedule</option>
              <option value="hotkey" ${this.wfTriggerFilter === 'hotkey' ? 'selected' : ''}>Hotkey</option>
              <option value="startup" ${this.wfTriggerFilter === 'startup' ? 'selected' : ''}>Startup</option>
              <option value="file_watch" ${this.wfTriggerFilter === 'file_watch' ? 'selected' : ''}>File Watcher</option>
            </select>
            <select id="wf-status-filter" class="form-select">
              <option value="all" ${this.wfStatusFilter === 'all' ? 'selected' : ''}>All States</option>
              <option value="enabled" ${this.wfStatusFilter === 'enabled' ? 'selected' : ''}>Enabled Only</option>
              <option value="disabled" ${this.wfStatusFilter === 'disabled' ? 'selected' : ''}>Disabled Only</option>
            </select>
          </div>
          <div class="btn-group">
            <button type="button" id="wf-open-import-btn" class="btn btn-secondary btn-sm">
              Import JSON
            </button>
            <button type="button" id="wf-export-all-btn" class="btn btn-secondary btn-sm">
              Export All JSON
            </button>
          </div>
        </div>

        ${
          filtered.length === 0
            ? `<div class="empty-state-box">
                <p>No workflows match the current filters.</p>
              </div>`
            : `<div class="workflow-cards-list">
                ${filtered
                  .map((wf) => {
                    const runningIds = this.runningExecutionIdsByWorkflow[wf.id] || [];
                    const isRunning = runningIds.length > 0;
                    const condCount = wf.conditionConfig?.conditions?.length || 0;
                    const actionPreview = wf.actions
                      .map((a) => ACTION_TYPE_LABELS[a.type] || a.type)
                      .join(' → ');

                    return `
                      <div class="workflow-card ${wf.isEnabled ? 'wf-enabled' : 'wf-disabled'}">
                        <div class="workflow-card-main">
                          <div class="workflow-card-title-row">
                            <h4>${this.escapeHtml(wf.name)}</h4>
                            <span class="badge ${
                              wf.isEnabled ? 'badge-emerald' : 'badge-slate'
                            }">${wf.isEnabled ? 'Enabled' : 'Disabled'}</span>
                            <span class="badge badge-blue">${this.formatTriggerBadge(wf)}</span>
                            ${
                              isRunning
                                ? `<span class="badge badge-amber">Running (#${runningIds[0]})</span>`
                                : ''
                            }
                          </div>
                          ${
                            wf.description
                              ? `<p class="workflow-card-desc">${this.escapeHtml(wf.description)}</p>`
                              : ''
                          }
                          <div class="workflow-pipeline-summary">
                            <span><strong>Conditions:</strong> ${
                              condCount > 0
                                ? `${condCount} (${wf.conditionConfig.operator})`
                                : 'None'
                            }</span>
                            <span>•</span>
                            <span><strong>Actions (${wf.actions.length}):</strong> ${this.escapeHtml(
                      actionPreview
                    )}</span>
                          </div>
                          <div class="workflow-timestamps">
                            <span>Last Run: <code>${
                              wf.lastExecutedAt
                                ? this.escapeHtml(this.formatDateTime(wf.lastExecutedAt))
                                : 'Never'
                            }</code></span>
                            ${
                              wf.nextExecutionAt
                                ? `<span>Next Scheduled: <code>${this.escapeHtml(
                                    this.formatDateTime(wf.nextExecutionAt)
                                  )}</code></span>`
                                : ''
                            }
                            <span>Policy: <code>onError=${wf.executionPolicy.onError}, retries=${
                      wf.executionPolicy.maxRetries
                    }, timeout=${wf.executionPolicy.timeoutMs}ms</code></span>
                          </div>
                        </div>

                        <div class="workflow-card-actions">
                          <label class="toggle-inline">
                            <input type="checkbox" data-toggle-wf="${wf.id}" ${
                      wf.isEnabled ? 'checked' : ''
                    } />
                            <span>${wf.isEnabled ? 'Enabled' : 'Disabled'}</span>
                          </label>
                          <div class="btn-group-wrap">
                            <button type="button" class="btn btn-primary btn-xs" data-run-wf="${
                              wf.id
                            }">Run Now</button>
                            <button type="button" class="btn btn-secondary btn-xs" data-test-wf="${
                              wf.id
                            }" title="Test workflow actions bypassing conditions">Test</button>
                            <button type="button" class="btn btn-ghost btn-xs" data-edit-wf="${
                              wf.id
                            }">Edit</button>
                            <button type="button" class="btn btn-ghost btn-xs" data-dup-wf="${
                              wf.id
                            }">Duplicate</button>
                            <button type="button" class="btn btn-ghost btn-xs" data-export-wf="${
                              wf.id
                            }">Export</button>
                            <button type="button" class="btn btn-danger-ghost btn-xs" data-delete-wf="${
                              wf.id
                            }">Delete</button>
                          </div>
                        </div>
                      </div>
                    `;
                  })
                  .join('')}
              </div>`
        }
      </div>
    `;
  }

  // ==========================================================================
  // 3. AUTOMATION BUILDER VIEW
  // ==========================================================================
  private renderBuilderView(): string {
    const errorsHtml =
      this.builderValidationErrors.length > 0
        ? `
          <div class="builder-error-banner">
            <strong>Please fix the following validation errors:</strong>
            <ul>
              ${this.builderValidationErrors
                .map((e) => `<li>${this.escapeHtml(e)}</li>`)
                .join('')}
            </ul>
          </div>
        `
        : '';

    return `
      <div class="automation-builder">
        ${errorsHtml}

        <!-- Step 1: Basic Information -->
        <div class="card builder-section">
          <div class="card-header">
            <h3 class="card-title">1. Workflow Identity & Status</h3>
            <div class="btn-group">
              <button type="button" class="btn btn-ghost btn-xs" data-load-template="morning_routine">
                Load Morning Template
              </button>
              <button type="button" class="btn btn-ghost btn-xs" data-load-template="hotkey_snapshot">
                Load Hotkey Template
              </button>
            </div>
          </div>
          <div class="form-grid-2">
            <div class="form-group">
              <label for="builder-wf-name">Workflow Name *</label>
              <input
                type="text"
                id="builder-wf-name"
                class="form-input"
                placeholder="e.g. Daily Morning Briefing"
                value="${this.escapeHtml(this.builderName)}"
              />
            </div>
            <div class="form-group">
              <label for="builder-wf-desc">Description</label>
              <input
                type="text"
                id="builder-wf-desc"
                class="form-input"
                placeholder="Optional summary of what this workflow automates"
                value="${this.escapeHtml(this.builderDescription)}"
              />
            </div>
          </div>
          <label class="checkbox-label">
            <input type="checkbox" id="builder-wf-enabled" ${
              this.builderEnabled ? 'checked' : ''
            } />
            <span>Enable workflow immediately after saving</span>
          </label>
        </div>

        <!-- Step 2: Trigger Configuration -->
        <div class="card builder-section">
          <div class="card-header">
            <h3 class="card-title">2. Trigger Configuration (When to Run)</h3>
          </div>
          <div class="form-group">
            <label for="builder-trigger-type">Trigger Type</label>
            <select id="builder-trigger-type" class="form-select">
              <option value="schedule" ${
                this.builderTriggerType === 'schedule' ? 'selected' : ''
              }>Schedule Trigger (One-time, Daily, Weekly, Monthly, Yearly)</option>
              <option value="hotkey" ${
                this.builderTriggerType === 'hotkey' ? 'selected' : ''
              }>Global Keyboard Shortcut Trigger</option>
              <option value="startup" ${
                this.builderTriggerType === 'startup' ? 'selected' : ''
              }>Application Startup Trigger</option>
              <option value="file_watch" ${
                this.builderTriggerType === 'file_watch' ? 'selected' : ''
              }>Local Folder / File Watcher Trigger</option>
            </select>
          </div>
          <div class="builder-trigger-fields">
            ${this.renderBuilderTriggerFields()}
          </div>
        </div>

        <!-- Step 3: Condition Engine -->
        <div class="card builder-section">
          <div class="card-header">
            <div>
              <h3 class="card-title">3. Conditions (Optional Guard Rules)</h3>
              <p class="card-subtitle">If conditions do not match, execution is marked as Skipped</p>
            </div>
            <div class="btn-group">
              <select id="builder-cond-operator" class="form-select form-select-sm">
                <option value="AND" ${
                  this.builderConditionConfig.operator === 'AND' ? 'selected' : ''
                }>Match ALL (AND)</option>
                <option value="OR" ${
                  this.builderConditionConfig.operator === 'OR' ? 'selected' : ''
                }>Match ANY (OR)</option>
              </select>
              <button type="button" id="builder-add-condition-btn" class="btn btn-secondary btn-xs">
                + Add Condition
              </button>
            </div>
          </div>
          ${this.renderBuilderConditionsList()}
        </div>

        <!-- Step 4: Actions Sequence -->
        <div class="card builder-section">
          <div class="card-header">
            <div>
              <h3 class="card-title">4. Action Sequence (Executed Top-to-Bottom)</h3>
              <p class="card-subtitle">Add, configure, reorder, duplicate, or remove workflow steps</p>
            </div>
            <button type="button" id="builder-add-action-btn" class="btn btn-primary btn-xs">
              + Add Action Step
            </button>
          </div>
          ${this.renderBuilderActionsList()}
        </div>

        <!-- Step 5: Execution Policy & Visual Flow Preview -->
        <div class="card builder-section">
          <div class="card-header">
            <h3 class="card-title">5. Execution Policy & Visual Pipeline Preview</h3>
          </div>
          <div class="form-grid-4">
            <div class="form-group">
              <label for="builder-policy-onerror">On Action Error</label>
              <select id="builder-policy-onerror" class="form-select">
                <option value="stop" ${
                  this.builderPolicy.onError === 'stop' ? 'selected' : ''
                }>Stop Workflow Immediately</option>
                <option value="continue" ${
                  this.builderPolicy.onError === 'continue' ? 'selected' : ''
                }>Continue Remaining Actions</option>
              </select>
            </div>
            <div class="form-group">
              <label for="builder-policy-timeout">Workflow Timeout (ms)</label>
              <input
                type="number"
                id="builder-policy-timeout"
                class="form-input"
                min="1000"
                step="1000"
                value="${this.builderPolicy.timeoutMs}"
              />
            </div>
            <div class="form-group">
              <label for="builder-policy-retries">Default Max Retries</label>
              <input
                type="number"
                id="builder-policy-retries"
                class="form-input"
                min="0"
                max="5"
                value="${this.builderPolicy.maxRetries}"
              />
            </div>
            <div class="form-group">
              <label for="builder-policy-retrydelay">Retry Delay (ms)</label>
              <input
                type="number"
                id="builder-policy-retrydelay"
                class="form-input"
                min="100"
                step="100"
                value="${this.builderPolicy.retryDelayMs}"
              />
            </div>
          </div>

          <div class="workflow-visual-preview">
            <div class="flow-node flow-trigger">
              <span class="flow-tag">TRIGGER</span>
              <strong>${this.escapeHtml(this.builderTriggerType.toUpperCase())}</strong>
            </div>
            <span class="flow-arrow">&rarr;</span>
            <div class="flow-node flow-condition">
              <span class="flow-tag">CONDITIONS (${this.builderConditionConfig.operator})</span>
              <strong>${this.builderConditionConfig.conditions.length} Rule(s)</strong>
            </div>
            <span class="flow-arrow">&rarr;</span>
            <div class="flow-node flow-actions">
              <span class="flow-tag">ACTIONS</span>
              <strong>${this.builderActions.length} Step(s)</strong>
            </div>
            <span class="flow-arrow">&rarr;</span>
            <div class="flow-node flow-result">
              <span class="flow-tag">POLICY</span>
              <strong>On Error: ${this.builderPolicy.onError.toUpperCase()}</strong>
            </div>
          </div>

          <div class="builder-footer-actions">
            <button type="button" id="builder-cancel-btn" class="btn btn-ghost">
              Cancel
            </button>
            <button type="button" id="builder-save-test-btn" class="btn btn-secondary">
              Save &amp; Run Test Now
            </button>
            <button type="button" id="builder-save-btn" class="btn btn-primary">
              ${this.builderId ? 'Update Workflow' : 'Save New Workflow'}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  private renderBuilderTriggerFields(): string {
    const cfg = this.builderTriggerConfig;
    if (this.builderTriggerType === 'schedule') {
      const freq = (cfg.frequency as ScheduleFrequency) || 'daily';
      const weekdays = Array.isArray(cfg.weekdays) ? (cfg.weekdays as number[]) : [1, 2, 3, 4, 5];
      const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

      return `
        <div class="form-grid-3">
          <div class="form-group">
            <label>Frequency</label>
            <select id="trig-sched-freq" class="form-select">
              <option value="once" ${freq === 'once' ? 'selected' : ''}>One-Time Execution</option>
              <option value="daily" ${freq === 'daily' ? 'selected' : ''}>Daily</option>
              <option value="weekly" ${freq === 'weekly' ? 'selected' : ''}>Weekly (Selected Weekdays)</option>
              <option value="monthly" ${freq === 'monthly' ? 'selected' : ''}>Monthly (Day of Month)</option>
              <option value="yearly" ${freq === 'yearly' ? 'selected' : ''}>Yearly (Month & Day)</option>
            </select>
          </div>

          ${
            freq === 'once'
              ? `<div class="form-group">
                  <label>Run Once Date &amp; Time *</label>
                  <input type="datetime-local" id="trig-sched-once" class="form-input" value="${this.escapeHtml(
                    String(cfg.onceDateTime || '')
                  )}" />
                </div>`
              : `<div class="form-group">
                  <label>Execution Time (24h HH:MM) *</label>
                  <input type="time" id="trig-sched-time" class="form-input" value="${this.escapeHtml(
                    String(cfg.time || '08:00')
                  )}" />
                </div>`
          }

          <div class="form-group">
            <label>Missed Schedule Policy</label>
            <select id="trig-sched-missed" class="form-select">
              <option value="run_once" ${
                cfg.missedPolicy === 'run_once' ? 'selected' : ''
              }>Run Once Immediately on Startup</option>
              <option value="skip" ${
                cfg.missedPolicy === 'skip' ? 'selected' : ''
              }>Skip &amp; Schedule Next</option>
              <option value="ask_user" ${
                cfg.missedPolicy === 'ask_user' ? 'selected' : ''
              }>Ask User Confirmation</option>
            </select>
          </div>
        </div>

        ${
          freq === 'weekly'
            ? `<div class="form-group">
                <label>Selected Weekdays</label>
                <div class="weekday-pills">
                  ${dayLabels
                    .map(
                      (lbl, idx) => `
                      <label class="weekday-pill">
                        <input type="checkbox" class="trig-weekday-cb" value="${idx}" ${
                        weekdays.includes(idx) ? 'checked' : ''
                      } />
                        <span>${lbl}</span>
                      </label>
                    `
                    )
                    .join('')}
                </div>
              </div>`
            : ''
        }

        ${
          freq === 'monthly' || freq === 'yearly'
            ? `<div class="form-grid-2">
                <div class="form-group">
                  <label>Day of Month (1 - 31)</label>
                  <input type="number" id="trig-sched-dom" class="form-input" min="1" max="31" value="${
                    Number(cfg.dayOfMonth) || 1
                  }" />
                </div>
                ${
                  freq === 'yearly'
                    ? `<div class="form-group">
                        <label>Month of Year (1 - 12)</label>
                        <input type="number" id="trig-sched-moy" class="form-input" min="1" max="12" value="${
                          Number(cfg.monthOfYear) || 1
                        }" />
                      </div>`
                    : ''
                }
              </div>`
            : ''
        }

        <div class="form-grid-2">
          <div class="form-group">
            <label>Start Date (Optional)</label>
            <input type="date" id="trig-sched-start" class="form-input" value="${this.escapeHtml(
              String(cfg.startDate || '')
            )}" />
          </div>
          <div class="form-group">
            <label>End Date (Optional)</label>
            <input type="date" id="trig-sched-end" class="form-input" value="${this.escapeHtml(
              String(cfg.endDate || '')
            )}" />
          </div>
        </div>
      `;
    }

    if (this.builderTriggerType === 'hotkey') {
      return `
        <div class="form-grid-2">
          <div class="form-group">
            <label>Global Keyboard Shortcut *</label>
            <input
              type="text"
              id="trig-hotkey-input"
              class="form-input"
              placeholder="e.g. CommandOrControl+Alt+W"
              value="${this.escapeHtml(String(cfg.shortcut || 'CommandOrControl+Alt+W'))}"
            />
            <span class="form-hint">Click the field and press your desired key combination, or type an Electron accelerator.</span>
          </div>
        </div>
      `;
    }

    if (this.builderTriggerType === 'startup') {
      return `
        <div class="form-grid-2">
          <div class="form-group">
            <label>Delay After App Startup (Seconds)</label>
            <input
              type="number"
              id="trig-startup-delay"
              class="form-input"
              min="0"
              max="3600"
              value="${Number(cfg.delaySeconds ?? 0)}"
            />
          </div>
          <div class="form-group">
            <label>&nbsp;</label>
            <label class="checkbox-label">
              <input type="checkbox" id="trig-startup-once" ${
                cfg.oncePerSession !== false ? 'checked' : ''
              } />
              <span>Run only once per application session</span>
            </label>
          </div>
        </div>
      `;
    }

    // file_watch
    const events = Array.isArray(cfg.events)
      ? (cfg.events as FileWatchEventType[])
      : (['created', 'changed'] as FileWatchEventType[]);
    const allEvs: FileWatchEventType[] = ['created', 'changed', 'deleted', 'renamed'];

    return `
      <div class="form-grid-2">
        <div class="form-group">
          <label>Monitored Local Folder Path *</label>
          <input
            type="text"
            id="trig-fw-folder"
            class="form-input"
            placeholder="e.g. C:\\Users\\Public\\Downloads"
            value="${this.escapeHtml(String(cfg.folderPath || ''))}"
          />
        </div>
        <div class="form-group">
          <label>File Events to Watch *</label>
          <div class="weekday-pills">
            ${allEvs
              .map(
                (ev) => `
                <label class="weekday-pill">
                  <input type="checkbox" class="trig-fw-event-cb" value="${ev}" ${
                  events.includes(ev) ? 'checked' : ''
                } />
                  <span>${ev}</span>
                </label>
              `
              )
              .join('')}
          </div>
        </div>
      </div>
      <div class="form-grid-3">
        <div class="form-group">
          <label>File Name Pattern (Optional)</label>
          <input
            type="text"
            id="trig-fw-pattern"
            class="form-input"
            placeholder="e.g. *.pdf or report"
            value="${this.escapeHtml(String(cfg.fileNamePattern || ''))}"
          />
        </div>
        <div class="form-group">
          <label>Extension Filter (Optional)</label>
          <input
            type="text"
            id="trig-fw-ext"
            class="form-input"
            placeholder="e.g. .pdf,.txt,.docx"
            value="${this.escapeHtml(String(cfg.extensionFilter || ''))}"
          />
        </div>
        <div class="form-group">
          <label>Debounce (ms)</label>
          <input
            type="number"
            id="trig-fw-debounce"
            class="form-input"
            min="100"
            value="${Number(cfg.debounceMs || this.settings.file_watcher_debounce_ms || 600)}"
          />
        </div>
      </div>
    `;
  }

  private renderBuilderConditionsList(): string {
    const conds = this.builderConditionConfig.conditions;
    if (conds.length === 0) {
      return `<p class="text-muted text-sm">No conditions configured — workflow will execute whenever triggered.</p>`;
    }

    const operators: ConditionOperator[] = [
      'equals',
      'not_equals',
      'greater_than',
      'less_than',
      'contains',
      'exists'
    ];

    return `
      <div class="builder-conditions-list">
        ${conds
          .map(
            (rule, idx) => `
            <div class="condition-rule-row" data-cond-index="${idx}">
              <select class="form-select cond-type-select" data-cond-idx="${idx}">
                ${(Object.keys(CONDITION_TYPE_LABELS) as ConditionType[])
                  .map(
                    (t) =>
                      `<option value="${t}" ${rule.type === t ? 'selected' : ''}>${
                        CONDITION_TYPE_LABELS[t]
                      }</option>`
                  )
                  .join('')}
              </select>
              <select class="form-select cond-op-select" data-cond-idx="${idx}">
                ${operators
                  .map(
                    (op) =>
                      `<option value="${op}" ${
                        rule.operator === op ? 'selected' : ''
                      }>${op}</option>`
                  )
                  .join('')}
              </select>
              <input
                type="text"
                class="form-input cond-target-input"
                data-cond-idx="${idx}"
                placeholder="Target (Path / ID / Start Date)"
                value="${this.escapeHtml(rule.target || '')}"
              />
              <input
                type="text"
                class="form-input cond-value-input"
                data-cond-idx="${idx}"
                placeholder="Expected Value"
                value="${this.escapeHtml(rule.value || '')}"
              />
              <button type="button" class="btn btn-danger-ghost btn-xs" data-remove-cond="${idx}">
                Remove
              </button>
            </div>
          `
          )
          .join('')}
      </div>
    `;
  }

  private renderBuilderActionsList(): string {
    if (this.builderActions.length === 0) {
      return `<div class="empty-state-box"><p>Add at least one action step to execute.</p></div>`;
    }

    return `
      <div class="builder-actions-list">
        ${this.builderActions
          .map(
            (step, idx) => `
            <div class="builder-action-card" data-action-index="${idx}">
              <div class="builder-action-header">
                <div class="action-step-title">
                  <span class="step-number-badge">Step #${idx + 1}</span>
                  <select class="form-select action-type-select" data-act-idx="${idx}">
                    ${(Object.keys(ACTION_TYPE_LABELS) as ActionType[])
                      .map(
                        (t) =>
                          `<option value="${t}" ${step.type === t ? 'selected' : ''}>${
                            ACTION_TYPE_LABELS[t]
                          }</option>`
                      )
                      .join('')}
                  </select>
                </div>
                <div class="btn-group">
                  <button type="button" class="btn btn-ghost btn-xs" data-move-act-up="${idx}" ${
              idx === 0 ? 'disabled' : ''
            } title="Move Step Up">&uarr;</button>
                  <button type="button" class="btn btn-ghost btn-xs" data-move-act-down="${idx}" ${
              idx === this.builderActions.length - 1 ? 'disabled' : ''
            } title="Move Step Down">&darr;</button>
                  <button type="button" class="btn btn-ghost btn-xs" data-dup-act="${idx}" title="Duplicate Step">Copy</button>
                  <button type="button" class="btn btn-danger-ghost btn-xs" data-remove-act="${idx}" title="Remove Step">Remove</button>
                </div>
              </div>

              <div class="builder-action-body">
                ${this.renderActionConfigFields(step, idx)}
              </div>

              <div class="builder-action-footer">
                <label class="text-xs text-muted">
                  Step Error Policy:
                  <select class="form-select-inline act-onerror-select" data-act-idx="${idx}">
                    <option value="inherit" ${
                      !step.onError || step.onError === 'inherit' ? 'selected' : ''
                    }>Inherit Workflow Policy</option>
                    <option value="stop" ${
                      step.onError === 'stop' ? 'selected' : ''
                    }>Stop Workflow</option>
                    <option value="continue" ${
                      step.onError === 'continue' ? 'selected' : ''
                    }>Continue Next Action</option>
                  </select>
                </label>
                <label class="text-xs text-muted">
                  Step Max Retries:
                  <input type="number" class="form-input-inline act-retries-input" data-act-idx="${idx}" min="0" max="5" value="${
              step.maxRetries ?? 0
            }" />
                </label>
              </div>
            </div>
          `
          )
          .join('')}
      </div>
    `;
  }

  private renderActionConfigFields(step: WorkflowActionStep, idx: number): string {
    const cfg = step.config || {};

    switch (step.type) {
      case 'open_application':
        return `
          <div class="form-grid-2">
            <div class="form-group">
              <label>Trusted Executable Path *</label>
              <input type="text" class="form-input act-cfg-input" data-act-idx="${idx}" data-cfg-key="executablePath" list="trusted-exe-datalist" placeholder="C:\\Windows\\System32\\notepad.exe" value="${this.escapeHtml(
          String(cfg.executablePath || '')
        )}" />
              <datalist id="trusted-exe-datalist">
                ${this.settings.trusted_app_paths
                  .map((p) => `<option value="${this.escapeHtml(p)}"></option>`)
                  .join('')}
              </datalist>
            </div>
            <div class="form-group">
              <label>Arguments (Optional)</label>
              <input type="text" class="form-input act-cfg-input" data-act-idx="${idx}" data-cfg-key="args" placeholder="Optional arguments" value="${this.escapeHtml(
          Array.isArray(cfg.args) ? cfg.args.join(' ') : String(cfg.args || '')
        )}" />
            </div>
          </div>
        `;

      case 'open_folder':
      case 'create_folder':
        return `
          <div class="form-group">
            <label>Local Folder Path *</label>
            <input type="text" class="form-input act-cfg-input" data-act-idx="${idx}" data-cfg-key="folderPath" placeholder="e.g. C:\\Users\\Public\\Documents" value="${this.escapeHtml(
          String(cfg.folderPath || '')
        )}" />
          </div>
        `;

      case 'open_url':
        return `
          <div class="form-group">
            <label>URL (http:// or https:// only) *</label>
            <input type="text" class="form-input act-cfg-input" data-act-idx="${idx}" data-cfg-key="url" placeholder="https://example.com" value="${this.escapeHtml(
          String(cfg.url || '')
        )}" />
          </div>
        `;

      case 'show_notification':
        return `
          <div class="form-grid-2">
            <div class="form-group">
              <label>Notification Title *</label>
              <input type="text" class="form-input act-cfg-input" data-act-idx="${idx}" data-cfg-key="title" value="${this.escapeHtml(
          String(cfg.title || '')
        )}" />
            </div>
            <div class="form-group">
              <label>Notification Message *</label>
              <input type="text" class="form-input act-cfg-input" data-act-idx="${idx}" data-cfg-key="body" value="${this.escapeHtml(
          String(cfg.body || '')
        )}" />
            </div>
          </div>
        `;

      case 'create_todo':
        return `
          <div class="form-grid-3">
            <div class="form-group">
              <label>Task Title *</label>
              <input type="text" class="form-input act-cfg-input" data-act-idx="${idx}" data-cfg-key="title" value="${this.escapeHtml(
          String(cfg.title || '')
        )}" />
            </div>
            <div class="form-group">
              <label>Priority</label>
              <select class="form-select act-cfg-input" data-act-idx="${idx}" data-cfg-key="priority">
                <option value="low" ${cfg.priority === 'low' ? 'selected' : ''}>Low</option>
                <option value="medium" ${
                  !cfg.priority || cfg.priority === 'medium' ? 'selected' : ''
                }>Medium</option>
                <option value="high" ${cfg.priority === 'high' ? 'selected' : ''}>High</option>
              </select>
            </div>
            <div class="form-group">
              <label>Due Offset (Minutes from run)</label>
              <input type="number" class="form-input act-cfg-input" data-act-idx="${idx}" data-cfg-key="dueOffsetMinutes" value="${this.escapeHtml(
          String(cfg.dueOffsetMinutes ?? 120)
        )}" />
            </div>
          </div>
          <div class="form-grid-2">
            <div class="form-group">
              <label>Category Name</label>
              <input type="text" class="form-input act-cfg-input" data-act-idx="${idx}" data-cfg-key="category" value="${this.escapeHtml(
          String(cfg.category || 'Work')
        )}" />
            </div>
            <div class="form-group">
              <label>Description</label>
              <input type="text" class="form-input act-cfg-input" data-act-idx="${idx}" data-cfg-key="description" value="${this.escapeHtml(
          String(cfg.description || '')
        )}" />
            </div>
          </div>
        `;

      case 'update_todo_status':
      case 'complete_todo':
        return `
          <div class="form-grid-3">
            <div class="form-group">
              <label>Task ID (or leave blank to match title)</label>
              <input type="number" class="form-input act-cfg-input" data-act-idx="${idx}" data-cfg-key="taskId" value="${this.escapeHtml(
          String(cfg.taskId || '')
        )}" />
            </div>
            <div class="form-group">
              <label>Task Title Match Substring</label>
              <input type="text" class="form-input act-cfg-input" data-act-idx="${idx}" data-cfg-key="titleMatch" value="${this.escapeHtml(
          String(cfg.titleMatch || '')
        )}" />
            </div>
            ${
              step.type === 'update_todo_status'
                ? `<div class="form-group">
                    <label>New Status</label>
                    <select class="form-select act-cfg-input" data-act-idx="${idx}" data-cfg-key="status">
                      <option value="todo" ${cfg.status === 'todo' ? 'selected' : ''}>Todo</option>
                      <option value="in_progress" ${
                        cfg.status === 'in_progress' ? 'selected' : ''
                      }>In Progress</option>
                      <option value="done" ${cfg.status === 'done' ? 'selected' : ''}>Done</option>
                    </select>
                  </div>`
                : ''
            }
          </div>
        `;

      case 'create_note':
        return `
          <div class="form-grid-3">
            <div class="form-group">
              <label>Note Title *</label>
              <input type="text" class="form-input act-cfg-input" data-act-idx="${idx}" data-cfg-key="title" value="${this.escapeHtml(
          String(cfg.title || '')
        )}" />
            </div>
            <div class="form-group">
              <label>Note Color</label>
              <select class="form-select act-cfg-input" data-act-idx="${idx}" data-cfg-key="color">
                <option value="slate" ${cfg.color === 'slate' ? 'selected' : ''}>Slate</option>
                <option value="blue" ${cfg.color === 'blue' ? 'selected' : ''}>Blue</option>
                <option value="emerald" ${cfg.color === 'emerald' ? 'selected' : ''}>Emerald</option>
                <option value="amber" ${cfg.color === 'amber' ? 'selected' : ''}>Amber</option>
                <option value="rose" ${cfg.color === 'rose' ? 'selected' : ''}>Rose</option>
              </select>
            </div>
            <div class="form-group">
              <label>Content *</label>
              <input type="text" class="form-input act-cfg-input" data-act-idx="${idx}" data-cfg-key="content" value="${this.escapeHtml(
          String(cfg.content || '')
        )}" />
            </div>
          </div>
        `;

      case 'update_note':
      case 'pin_note':
        return `
          <div class="form-grid-3">
            <div class="form-group">
              <label>Note ID (Optional)</label>
              <input type="number" class="form-input act-cfg-input" data-act-idx="${idx}" data-cfg-key="noteId" value="${this.escapeHtml(
          String(cfg.noteId || '')
        )}" />
            </div>
            <div class="form-group">
              <label>Note Title Match</label>
              <input type="text" class="form-input act-cfg-input" data-act-idx="${idx}" data-cfg-key="titleMatch" value="${this.escapeHtml(
          String(cfg.titleMatch || '')
        )}" />
            </div>
            ${
              step.type === 'update_note'
                ? `<div class="form-group">
                    <label>Content to Append / Replace</label>
                    <input type="text" class="form-input act-cfg-input" data-act-idx="${idx}" data-cfg-key="content" value="${this.escapeHtml(
                    String(cfg.content || '')
                  )}" />
                  </div>`
                : ''
            }
          </div>
        `;

      case 'create_reminder':
        return `
          <div class="form-grid-3">
            <div class="form-group">
              <label>Reminder Title *</label>
              <input type="text" class="form-input act-cfg-input" data-act-idx="${idx}" data-cfg-key="title" value="${this.escapeHtml(
          String(cfg.title || '')
        )}" />
            </div>
            <div class="form-group">
              <label>Offset Minutes from Execution</label>
              <input type="number" class="form-input act-cfg-input" data-act-idx="${idx}" data-cfg-key="offsetMinutes" value="${this.escapeHtml(
          String(cfg.offsetMinutes ?? 30)
        )}" />
            </div>
            <div class="form-group">
              <label>Recurrence</label>
              <select class="form-select act-cfg-input" data-act-idx="${idx}" data-cfg-key="recurrence">
                <option value="none" ${cfg.recurrence === 'none' ? 'selected' : ''}>Once</option>
                <option value="daily" ${cfg.recurrence === 'daily' ? 'selected' : ''}>Daily</option>
                <option value="weekly" ${cfg.recurrence === 'weekly' ? 'selected' : ''}>Weekly</option>
              </select>
            </div>
          </div>
        `;

      case 'enable_reminder':
      case 'disable_reminder':
        return `
          <div class="form-grid-2">
            <div class="form-group">
              <label>Reminder ID (Optional)</label>
              <input type="number" class="form-input act-cfg-input" data-act-idx="${idx}" data-cfg-key="reminderId" value="${this.escapeHtml(
          String(cfg.reminderId || '')
        )}" />
            </div>
            <div class="form-group">
              <label>Reminder Title Match</label>
              <input type="text" class="form-input act-cfg-input" data-act-idx="${idx}" data-cfg-key="titleMatch" value="${this.escapeHtml(
          String(cfg.titleMatch || '')
        )}" />
            </div>
          </div>
        `;

      case 'copy_file':
      case 'move_file':
        return `
          <div class="form-grid-2">
            <div class="form-group">
              <label>Source File Path *</label>
              <input type="text" class="form-input act-cfg-input" data-act-idx="${idx}" data-cfg-key="sourcePath" placeholder="C:\\Path\\To\\Source.txt" value="${this.escapeHtml(
          String(cfg.sourcePath || '')
        )}" />
            </div>
            <div class="form-group">
              <label>Destination File or Folder Path *</label>
              <input type="text" class="form-input act-cfg-input" data-act-idx="${idx}" data-cfg-key="destinationPath" placeholder="C:\\Path\\To\\Backup\\Source.txt" value="${this.escapeHtml(
          String(cfg.destinationPath || '')
        )}" />
            </div>
          </div>
          <label class="checkbox-label">
            <input type="checkbox" class="act-cfg-checkbox" data-act-idx="${idx}" data-cfg-key="overwrite" ${
          cfg.overwrite ? 'checked' : ''
        } />
            <span>Allow overwriting destination file if it already exists</span>
          </label>
        `;

      case 'rename_file':
        return `
          <div class="form-grid-2">
            <div class="form-group">
              <label>Existing File Path *</label>
              <input type="text" class="form-input act-cfg-input" data-act-idx="${idx}" data-cfg-key="filePath" placeholder="C:\\Path\\To\\File.txt" value="${this.escapeHtml(
          String(cfg.filePath || '')
        )}" />
            </div>
            <div class="form-group">
              <label>New File Name (without path separators) *</label>
              <input type="text" class="form-input act-cfg-input" data-act-idx="${idx}" data-cfg-key="newName" placeholder="RenamedFile.txt" value="${this.escapeHtml(
          String(cfg.newName || '')
        )}" />
            </div>
          </div>
        `;

      case 'delay':
        return `
          <div class="form-group">
            <label>Delay Duration (Milliseconds) *</label>
            <input type="number" class="form-input act-cfg-input" data-act-idx="${idx}" data-cfg-key="delayMs" min="0" max="3600000" value="${
          Number(cfg.delayMs ?? 1000)
        }" />
          </div>
        `;

      case 'stop_workflow':
        return `
          <div class="form-group">
            <label>Stop Reason / Log Message</label>
            <input type="text" class="form-input act-cfg-input" data-act-idx="${idx}" data-cfg-key="reason" value="${this.escapeHtml(
          String(cfg.reason || 'Stopped by Stop Workflow action')
        )}" />
          </div>
        `;

      case 'if_else': {
        const condRule: ConditionRule = step.conditionGroup?.conditions?.[0] || {
          id: `if_cond_${idx}`,
          type: 'todo_incomplete_count',
          operator: 'greater_than',
          value: '0'
        };
        const thenStep = step.thenActions?.[0] || {
          id: `then_${idx}`,
          type: 'show_notification' as ActionType,
          config: { title: 'If Branch Matched', body: 'Condition evaluated TRUE' }
        };
        return `
          <div class="if-else-builder-box">
            <div class="form-grid-3">
              <div class="form-group">
                <label>IF Condition Type</label>
                <select class="form-select ifelse-cond-type" data-act-idx="${idx}">
                  ${(Object.keys(CONDITION_TYPE_LABELS) as ConditionType[])
                    .map(
                      (t) =>
                        `<option value="${t}" ${condRule.type === t ? 'selected' : ''}>${
                          CONDITION_TYPE_LABELS[t]
                        }</option>`
                    )
                    .join('')}
                </select>
              </div>
              <div class="form-group">
                <label>IF Operator</label>
                <select class="form-select ifelse-cond-op" data-act-idx="${idx}">
                  <option value="equals" ${condRule.operator === 'equals' ? 'selected' : ''}>equals</option>
                  <option value="not_equals" ${condRule.operator === 'not_equals' ? 'selected' : ''}>not_equals</option>
                  <option value="greater_than" ${condRule.operator === 'greater_than' ? 'selected' : ''}>greater_than</option>
                  <option value="less_than" ${condRule.operator === 'less_than' ? 'selected' : ''}>less_than</option>
                </select>
              </div>
              <div class="form-group">
                <label>IF Expected Value</label>
                <input type="text" class="form-input ifelse-cond-val" data-act-idx="${idx}" value="${this.escapeHtml(
          condRule.value
        )}" />
              </div>
            </div>
            <div class="form-grid-2">
              <div class="form-group">
                <label>THEN Notification Title</label>
                <input type="text" class="form-input ifelse-then-title" data-act-idx="${idx}" value="${this.escapeHtml(
          String(thenStep.config?.title || 'If Branch Matched')
        )}" />
              </div>
              <div class="form-group">
                <label>THEN Notification Body</label>
                <input type="text" class="form-input ifelse-then-body" data-act-idx="${idx}" value="${this.escapeHtml(
          String(thenStep.config?.body || 'Condition evaluated TRUE')
        )}" />
              </div>
            </div>
          </div>
        `;
      }

      default:
        return '';
    }
  }

  // ==========================================================================
  // 4. EXECUTION HISTORY VIEW
  // ==========================================================================
  private renderHistoryView(): string {
    return `
      <div class="card">
        <div class="card-header">
          <div>
            <h3 class="card-title">Execution History &amp; Action Logs (${this.historyTotal} total)</h3>
            <p class="card-subtitle">Filter by workflow, status, date range, or keyword</p>
          </div>
          <div class="btn-group">
            <button type="button" id="hist-refresh-btn" class="btn btn-secondary btn-xs">Refresh</button>
            <button type="button" id="hist-clear-all-btn" class="btn btn-danger-ghost btn-xs">Clear History</button>
          </div>
        </div>

        <div class="automation-toolbar">
          <div class="automation-filters">
            <select id="hist-wf-filter" class="form-select">
              <option value="">All Workflows</option>
              ${this.workflows
                .map(
                  (w) =>
                    `<option value="${w.id}" ${
                      this.historyFilterWorkflowId === w.id ? 'selected' : ''
                    }>${this.escapeHtml(w.name)}</option>`
                )
                .join('')}
            </select>
            <select id="hist-status-filter" class="form-select">
              <option value="all" ${this.historyFilterStatus === 'all' ? 'selected' : ''}>All Statuses</option>
              <option value="success" ${this.historyFilterStatus === 'success' ? 'selected' : ''}>Success</option>
              <option value="failed" ${this.historyFilterStatus === 'failed' ? 'selected' : ''}>Failed</option>
              <option value="running" ${this.historyFilterStatus === 'running' ? 'selected' : ''}>Running</option>
              <option value="skipped" ${this.historyFilterStatus === 'skipped' ? 'selected' : ''}>Skipped</option>
              <option value="cancelled" ${this.historyFilterStatus === 'cancelled' ? 'selected' : ''}>Cancelled</option>
            </select>
            <input type="date" id="hist-date-from" class="form-input" value="${this.escapeHtml(
              this.historyFilterDateFrom
            )}" title="From Date" />
            <input type="date" id="hist-date-to" class="form-input" value="${this.escapeHtml(
              this.historyFilterDateTo
            )}" title="To Date" />
            <input type="text" id="hist-search-input" class="form-input" placeholder="Search logs..." value="${this.escapeHtml(
              this.historyFilterSearch
            )}" />
            <button type="button" id="hist-apply-filter-btn" class="btn btn-primary btn-sm">Filter</button>
          </div>
        </div>

        ${
          this.historyItems.length === 0
            ? `<div class="empty-state-box"><p>No execution records match your filter criteria.</p></div>`
            : `<div class="table-responsive">
                <table class="data-table">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Workflow</th>
                      <th>Trigger</th>
                      <th>Status</th>
                      <th>Started At</th>
                      <th>Duration</th>
                      <th>Summary / Error</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${this.historyItems
                      .map(
                        (ex) => `
                        <tr>
                          <td><code>#${ex.id}</code></td>
                          <td><strong>${this.escapeHtml(ex.workflow_name)}</strong></td>
                          <td><span class="badge badge-slate">${this.escapeHtml(
                            ex.trigger_type
                          )}</span></td>
                          <td>${this.renderStatusBadge(ex.status)}</td>
                          <td class="text-xs">${this.escapeHtml(
                            this.formatDateTime(ex.started_at)
                          )}</td>
                          <td class="text-xs"><code>${ex.duration_ms} ms</code></td>
                          <td class="text-xs text-muted">${
                            ex.error_message
                              ? this.escapeHtml(ex.error_message.slice(0, 90))
                              : 'Completed all steps'
                          }</td>
                          <td>
                            <div class="btn-group">
                              <button type="button" class="btn btn-secondary btn-xs" data-view-exec="${
                                ex.id
                              }">View Steps</button>
                              ${
                                ex.status === 'running'
                                  ? `<button type="button" class="btn btn-danger btn-xs" data-cancel-exec="${ex.id}">Cancel</button>`
                                  : `<button type="button" class="btn btn-ghost btn-xs" data-retry-exec="${ex.id}">Retry</button>`
                              }
                              <button type="button" class="btn btn-danger-ghost btn-xs" data-delete-exec="${
                                ex.id
                              }">&times;</button>
                            </div>
                          </td>
                        </tr>
                      `
                      )
                      .join('')}
                  </tbody>
                </table>
              </div>`
        }
      </div>
    `;
  }

  // ==========================================================================
  // 5. AUTOMATION SETTINGS VIEW
  // ==========================================================================
  private renderSettingsView(): string {
    return `
      <div class="automation-settings-grid">
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Global Automation Engine Preferences</h3>
          </div>
          <div class="form-group">
            <label class="checkbox-label">
              <input type="checkbox" id="aset-engine-enabled" ${
                this.settings.engine_enabled ? 'checked' : ''
              } />
              <span><strong>Enable Background Automation Engine</strong> (Schedules, Hotkeys, Startup, File Watchers)</span>
            </label>
          </div>
          <div class="form-group">
            <label class="checkbox-label">
              <input type="checkbox" id="aset-notifications-enabled" ${
                this.settings.notifications_enabled ? 'checked' : ''
              } />
              <span>Enable Desktop Notifications from Automation Workflows</span>
            </label>
          </div>

          <div class="form-grid-2">
            <div class="form-group">
              <label for="aset-max-concurrent">Max Concurrent Workflows (1-10)</label>
              <input type="number" id="aset-max-concurrent" class="form-input" min="1" max="10" value="${
                this.settings.max_concurrent_workflows
              }" />
            </div>
            <div class="form-group">
              <label for="aset-default-timeout">Default Workflow Timeout (ms)</label>
              <input type="number" id="aset-default-timeout" class="form-input" min="1000" step="1000" value="${
                this.settings.default_timeout_ms
              }" />
            </div>
            <div class="form-group">
              <label for="aset-default-error">Default Error Policy</label>
              <select id="aset-default-error" class="form-select">
                <option value="stop" ${
                  this.settings.default_error_policy === 'stop' ? 'selected' : ''
                }>Stop Workflow on Error</option>
                <option value="continue" ${
                  this.settings.default_error_policy === 'continue' ? 'selected' : ''
                }>Continue Next Action</option>
              </select>
            </div>
            <div class="form-group">
              <label for="aset-missed-policy">Default Missed Schedule Policy</label>
              <select id="aset-missed-policy" class="form-select">
                <option value="run_once" ${
                  this.settings.missed_schedule_policy === 'run_once' ? 'selected' : ''
                }>Run Once Immediately on Startup</option>
                <option value="skip" ${
                  this.settings.missed_schedule_policy === 'skip' ? 'selected' : ''
                }>Skip Missed Run</option>
                <option value="ask_user" ${
                  this.settings.missed_schedule_policy === 'ask_user' ? 'selected' : ''
                }>Ask User Confirmation</option>
              </select>
            </div>
            <div class="form-group">
              <label for="aset-retention-days">Execution History Retention (Days)</label>
              <input type="number" id="aset-retention-days" class="form-input" min="1" max="365" value="${
                this.settings.history_retention_days
              }" />
            </div>
            <div class="form-group">
              <label for="aset-fw-debounce">Default File Watcher Debounce (ms)</label>
              <input type="number" id="aset-fw-debounce" class="form-input" min="100" step="100" value="${
                this.settings.file_watcher_debounce_ms
              }" />
            </div>
          </div>

          <div class="modal-footer-actions">
            <button type="button" id="aset-save-btn" class="btn btn-primary">
              Save Engine Settings
            </button>
          </div>
        </div>

        <!-- Trusted Application Executable Paths Allowlist -->
        <div class="card">
          <div class="card-header">
            <div>
              <h3 class="card-title">Trusted Application Paths Allowlist</h3>
              <p class="card-subtitle">Security control: Open Application actions can only launch executables listed here. Shell interpreters (cmd.exe, powershell.exe) are strictly blocked.</p>
            </div>
          </div>
          <div class="trusted-paths-list">
            ${this.settings.trusted_app_paths
              .map(
                (exePath, idx) => `
                <div class="trusted-path-item">
                  <code>${this.escapeHtml(exePath)}</code>
                  <button type="button" class="btn btn-danger-ghost btn-xs" data-remove-trusted-path="${idx}">Remove</button>
                </div>
              `
              )
              .join('')}
          </div>
          <div class="trusted-path-add-row">
            <input
              type="text"
              id="aset-new-trusted-path"
              class="form-input"
              placeholder="e.g. C:\\Program Files\\Mozilla Firefox\\firefox.exe"
            />
            <button type="button" id="aset-add-trusted-btn" class="btn btn-secondary btn-sm">
              + Add Trusted Path
            </button>
          </div>
        </div>
      </div>
    `;
  }

  // ==========================================================================
  // MODALS: EXECUTION STEP LOGS & JSON IMPORT / EXPORT
  // ==========================================================================
  private renderExecutionDetailsModal(): string {
    if (!this.selectedExecutionDetail) return '';
    const { execution, actionLogs } = this.selectedExecutionDetail;

    return `
      <div class="modal-backdrop" id="auto-exec-detail-modal" role="dialog" aria-modal="true">
        <div class="modal-dialog modal-dialog-lg card">
          <div class="modal-header">
            <h3>Execution #${execution.id} — ${this.escapeHtml(execution.workflow_name)}</h3>
            <button type="button" id="close-exec-detail-modal" class="btn-icon">&times;</button>
          </div>
          <div class="modal-body">
            <div class="exec-meta-summary">
              <span><strong>Status:</strong> ${this.renderStatusBadge(execution.status)}</span>
              <span><strong>Trigger:</strong> <code>${this.escapeHtml(
                execution.trigger_type
              )}</code></span>
              <span><strong>Duration:</strong> <code>${execution.duration_ms} ms</code></span>
              <span><strong>Started:</strong> ${this.escapeHtml(
                this.formatDateTime(execution.started_at)
              )}</span>
            </div>
            ${
              execution.error_message
                ? `<div class="builder-error-banner">${this.escapeHtml(
                    execution.error_message
                  )}</div>`
                : ''
            }
            <h4>Step-by-Step Action Execution Logs (${actionLogs.length})</h4>
            ${
              actionLogs.length === 0
                ? `<p class="text-muted">No action steps were executed (workflow may have been skipped by conditions).</p>`
                : `<div class="table-responsive">
                    <table class="data-table">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Action Type</th>
                          <th>Status</th>
                          <th>Duration</th>
                          <th>Input</th>
                          <th>Output / Error</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${actionLogs
                          .map(
                            (log) => `
                            <tr>
                              <td><code>#${log.action_index}</code></td>
                              <td><strong>${this.escapeHtml(log.action_type)}</strong></td>
                              <td>${this.renderStatusBadge(log.status)}</td>
                              <td><code>${log.duration_ms} ms</code></td>
                              <td><code class="text-xs">${this.escapeHtml(
                                log.input_summary
                              )}</code></td>
                              <td class="text-xs">${
                                log.error_message
                                  ? `<span class="text-danger">${this.escapeHtml(
                                      log.error_message
                                    )}</span>`
                                  : this.escapeHtml(log.output_summary)
                              }</td>
                            </tr>
                          `
                          )
                          .join('')}
                      </tbody>
                    </table>
                  </div>`
            }
          </div>
        </div>
      </div>
    `;
  }

  private renderImportExportModal(): string {
    if (this.importExportModalMode === 'closed') return '';

    if (this.importExportModalMode === 'export') {
      return `
        <div class="modal-backdrop" id="auto-json-modal" role="dialog" aria-modal="true">
          <div class="modal-dialog modal-dialog-lg card">
            <div class="modal-header">
              <h3>Export Automation Workflow(s) to JSON</h3>
              <button type="button" id="close-json-modal" class="btn-icon">&times;</button>
            </div>
            <div class="modal-body">
              <textarea id="export-json-textarea" class="form-textarea json-code-box" rows="14" readonly>${this.escapeHtml(
                this.exportJsonText
              )}</textarea>
              <div class="modal-footer-actions">
                <button type="button" id="copy-export-json-btn" class="btn btn-primary">
                  Copy JSON to Clipboard
                </button>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    // Import mode
    const preview = this.importPreviewResult;
    return `
      <div class="modal-backdrop" id="auto-json-modal" role="dialog" aria-modal="true">
        <div class="modal-dialog modal-dialog-lg card">
          <div class="modal-header">
            <h3>Import Automation Workflow(s) from JSON</h3>
            <button type="button" id="close-json-modal" class="btn-icon">&times;</button>
          </div>
          <div class="modal-body">
            <p class="text-muted text-sm">Paste exported workflow JSON below. Imported workflows are validated and created in a <strong>Disabled</strong> state for safety (never auto-executed).</p>
            <textarea id="import-json-textarea" class="form-textarea json-code-box" rows="10" placeholder='{"schemaVersion":"3.0","workflows":[...]}'>${this.escapeHtml(
              this.importJsonText
            )}</textarea>

            ${
              preview
                ? `
                  <div class="import-preview-box ${
                    preview.valid ? 'preview-ok' : 'preview-err'
                  }">
                    <strong>Validation Result: ${
                      preview.valid
                        ? `Valid (${preview.workflows.length} workflow(s) ready to import)`
                        : 'Validation Failed'
                    }</strong>
                    ${
                      preview.errors.length > 0
                        ? `<ul>${preview.errors
                            .map((e) => `<li class="text-danger">${this.escapeHtml(e)}</li>`)
                            .join('')}</ul>`
                        : ''
                    }
                    ${
                      preview.warnings.length > 0
                        ? `<ul>${preview.warnings
                            .map((w) => `<li class="text-amber">${this.escapeHtml(w)}</li>`)
                            .join('')}</ul>`
                        : ''
                    }
                  </div>
                `
                : ''
            }

            <div class="modal-footer-actions">
              <button type="button" id="preview-import-json-btn" class="btn btn-secondary">
                1. Validate &amp; Preview
              </button>
              <button type="button" id="confirm-import-json-btn" class="btn btn-primary" ${
                preview && preview.valid ? '' : 'disabled'
              }>
                2. Confirm Import (Disabled)
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // ==========================================================================
  // EVENT BINDINGS
  // ==========================================================================
  private bindEvents(): void {
    // Sub-tab switching
    this.container.querySelectorAll<HTMLElement>('[data-auto-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-auto-tab') as AutomationSubTab;
        if (tab === 'builder' && !this.builderId && this.builderActions.length === 0) {
          this.resetBuilderForNew();
        }
        this.switchSubTab(tab);
      });
    });

    const newWfBtn = this.container.querySelector('#auto-new-wf-btn');
    newWfBtn?.addEventListener('click', () => {
      this.resetBuilderForNew();
      this.switchSubTab('builder');
    });

    const emptyCreateBtn = this.container.querySelector('#empty-create-wf-btn');
    emptyCreateBtn?.addEventListener('click', () => {
      this.resetBuilderForNew();
      this.switchSubTab('builder');
    });

    // Template loaders
    this.container.querySelectorAll<HTMLElement>('[data-load-template]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-load-template') || '';
        this.loadPresetTemplate(key);
      });
    });

    // Missed schedule approvals
    this.container.querySelectorAll<HTMLElement>('[data-approve-missed]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = Number(btn.getAttribute('data-approve-missed'));
        const res = await ipcService.resolveMissedScheduleApproval(id, true);
        toast.show(res.message, res.success ? 'success' : 'error');
        await this.refresh();
      });
    });
    this.container.querySelectorAll<HTMLElement>('[data-dismiss-missed]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = Number(btn.getAttribute('data-dismiss-missed'));
        const res = await ipcService.resolveMissedScheduleApproval(id, false);
        toast.show(res.message, 'info');
        await this.refresh();
      });
    });

    // Workflow actions: Toggle, Run Now, Test, Edit, Duplicate, Export, Delete
    this.container.querySelectorAll<HTMLInputElement>('[data-toggle-wf]').forEach((cb) => {
      cb.addEventListener('change', async () => {
        const id = Number(cb.getAttribute('data-toggle-wf'));
        const res = await ipcService.toggleAutomationWorkflow(id, cb.checked);
        toast.show(res.message, res.success ? 'success' : 'error');
        await this.refresh();
      });
    });

    this.container.querySelectorAll<HTMLElement>('[data-run-wf]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = Number(btn.getAttribute('data-run-wf'));
        toast.show('Executing workflow...', 'info', 2000);
        const res = await ipcService.runAutomationWorkflow(id);
        toast.show(res.message, res.success ? 'success' : 'error');
        this.onDataChanged?.();
        await this.refresh();
      });
    });

    this.container.querySelectorAll<HTMLElement>('[data-test-wf]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = Number(btn.getAttribute('data-test-wf'));
        toast.show('Running test execution (skipping guard conditions)...', 'info', 2000);
        const res = await ipcService.runAutomationWorkflow(id, {
          skipConditions: true,
          isTestRun: true
        });
        toast.show(res.message, res.success ? 'success' : 'error');
        this.onDataChanged?.();
        await this.refresh();
      });
    });

    this.container.querySelectorAll<HTMLElement>('[data-edit-wf]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = Number(btn.getAttribute('data-edit-wf'));
        const wf = this.workflows.find((w) => w.id === id);
        if (wf) {
          this.loadWorkflowIntoBuilder(wf);
          this.switchSubTab('builder');
        }
      });
    });

    this.container.querySelectorAll<HTMLElement>('[data-dup-wf]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = Number(btn.getAttribute('data-dup-wf'));
        const res = await ipcService.duplicateAutomationWorkflow(id);
        toast.show(res.message, res.success ? 'success' : 'error');
        await this.refresh();
      });
    });

    this.container.querySelectorAll<HTMLElement>('[data-export-wf]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = Number(btn.getAttribute('data-export-wf'));
        const res = await ipcService.exportAutomationWorkflows([id]);
        this.exportJsonText = res.json;
        this.importExportModalMode = 'export';
        this.render();
      });
    });

    this.container.querySelectorAll<HTMLElement>('[data-delete-wf]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = Number(btn.getAttribute('data-delete-wf'));
        const wf = this.workflows.find((w) => w.id === id);
        const confirmed = await confirmDialog.ask({
          title: 'Delete Automation Workflow',
          message: `Are you sure you want to permanently delete "${
            wf?.name || `#${id}`
          }" and all of its execution logs?`,
          confirmLabel: 'Delete Workflow',
          danger: true
        });
        if (!confirmed) return;
        const res = await ipcService.deleteAutomationWorkflow(id);
        toast.show(res.message, res.success ? 'info' : 'error');
        await this.refresh();
      });
    });

    // Execution log actions: View Details, Cancel, Retry, Delete
    this.container.querySelectorAll<HTMLElement>('[data-view-exec]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const execId = Number(btn.getAttribute('data-view-exec'));
        const details = await ipcService.getAutomationExecutionDetails(execId);
        if (details.execution) {
          this.selectedExecutionDetail = {
            execution: details.execution,
            actionLogs: details.actionLogs
          };
          this.render();
        }
      });
    });

    this.container.querySelectorAll<HTMLElement>('[data-cancel-exec]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const execId = Number(btn.getAttribute('data-cancel-exec'));
        const res = await ipcService.cancelAutomationExecution(execId);
        toast.show(res.message, res.success ? 'info' : 'error');
        await this.refresh();
      });
    });

    this.container.querySelectorAll<HTMLElement>('[data-retry-exec]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const execId = Number(btn.getAttribute('data-retry-exec'));
        const res = await ipcService.retryAutomationExecution(execId);
        toast.show(res.message, res.success ? 'success' : 'error');
        this.onDataChanged?.();
        await this.refresh();
      });
    });

    this.container.querySelectorAll<HTMLElement>('[data-delete-exec]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const execId = Number(btn.getAttribute('data-delete-exec'));
        await ipcService.deleteAutomationExecution(execId);
        await this.loadHistoryPage();
      });
    });

    // Close modals
    const closeExecModalBtn = this.container.querySelector('#close-exec-detail-modal');
    closeExecModalBtn?.addEventListener('click', () => {
      this.selectedExecutionDetail = null;
      this.render();
    });

    const closeJsonModalBtn = this.container.querySelector('#close-json-modal');
    closeJsonModalBtn?.addEventListener('click', () => {
      this.importExportModalMode = 'closed';
      this.importPreviewResult = null;
      this.render();
    });

    // Import / Export toolbar buttons
    const exportAllBtn = this.container.querySelector('#wf-export-all-btn');
    exportAllBtn?.addEventListener('click', async () => {
      const res = await ipcService.exportAutomationWorkflows();
      this.exportJsonText = res.json;
      this.importExportModalMode = 'export';
      this.render();
    });

    const openImportBtn = this.container.querySelector('#wf-open-import-btn');
    openImportBtn?.addEventListener('click', () => {
      this.importJsonText = '';
      this.importPreviewResult = null;
      this.importExportModalMode = 'import';
      this.render();
    });

    const copyExportBtn = this.container.querySelector('#copy-export-json-btn');
    copyExportBtn?.addEventListener('click', async () => {
      await navigator.clipboard.writeText(this.exportJsonText);
      toast.show('Copied workflow JSON to clipboard.', 'success');
    });

    const previewImportBtn = this.container.querySelector('#preview-import-json-btn');
    previewImportBtn?.addEventListener('click', async () => {
      const ta = this.container.querySelector(
        '#import-json-textarea'
      ) as HTMLTextAreaElement | null;
      this.importJsonText = ta ? ta.value : '';
      this.importPreviewResult = await ipcService.previewImportAutomationWorkflows(
        this.importJsonText
      );
      this.render();
    });

    const confirmImportBtn = this.container.querySelector('#confirm-import-json-btn');
    confirmImportBtn?.addEventListener('click', async () => {
      const res = await ipcService.importAutomationWorkflows(this.importJsonText);
      if (res.success) {
        this.importExportModalMode = 'closed';
        this.importPreviewResult = null;
        toast.show(res.message, 'success');
        await this.refresh();
      } else {
        toast.show(res.message, 'error');
      }
    });

    // Sub-view specific bindings
    if (this.activeTab === 'workflows') {
      this.bindWorkflowsFilterEvents();
    } else if (this.activeTab === 'builder') {
      this.bindBuilderEvents();
    } else if (this.activeTab === 'history') {
      this.bindHistoryFilterEvents();
    } else if (this.activeTab === 'settings') {
      this.bindSettingsEvents();
    }
  }

  private bindWorkflowsFilterEvents(): void {
    const searchInput = this.container.querySelector(
      '#wf-search-input'
    ) as HTMLInputElement | null;
    searchInput?.addEventListener('input', () => {
      this.wfSearch = searchInput.value;
      this.render();
      const refocused = this.container.querySelector(
        '#wf-search-input'
      ) as HTMLInputElement | null;
      refocused?.focus();
      refocused?.setSelectionRange(this.wfSearch.length, this.wfSearch.length);
    });

    const trigSel = this.container.querySelector(
      '#wf-trigger-filter'
    ) as HTMLSelectElement | null;
    trigSel?.addEventListener('change', () => {
      this.wfTriggerFilter = trigSel.value as 'all' | TriggerType;
      this.render();
    });

    const statusSel = this.container.querySelector(
      '#wf-status-filter'
    ) as HTMLSelectElement | null;
    statusSel?.addEventListener('change', () => {
      this.wfStatusFilter = statusSel.value as 'all' | 'enabled' | 'disabled';
      this.render();
    });
  }

  private syncBuilderDomState(): void {
    const nameEl = this.container.querySelector('#builder-wf-name') as HTMLInputElement | null;
    const descEl = this.container.querySelector('#builder-wf-desc') as HTMLInputElement | null;
    const enEl = this.container.querySelector('#builder-wf-enabled') as HTMLInputElement | null;
    if (nameEl) this.builderName = nameEl.value;
    if (descEl) this.builderDescription = descEl.value;
    if (enEl) this.builderEnabled = enEl.checked;

    // Trigger config
    if (this.builderTriggerType === 'schedule') {
      const freqEl = this.container.querySelector('#trig-sched-freq') as HTMLSelectElement | null;
      const onceEl = this.container.querySelector('#trig-sched-once') as HTMLInputElement | null;
      const timeEl = this.container.querySelector('#trig-sched-time') as HTMLInputElement | null;
      const missedEl = this.container.querySelector(
        '#trig-sched-missed'
      ) as HTMLSelectElement | null;
      const domEl = this.container.querySelector('#trig-sched-dom') as HTMLInputElement | null;
      const moyEl = this.container.querySelector('#trig-sched-moy') as HTMLInputElement | null;
      const startEl = this.container.querySelector('#trig-sched-start') as HTMLInputElement | null;
      const endEl = this.container.querySelector('#trig-sched-end') as HTMLInputElement | null;

      const checkedWeekdays: number[] = [];
      this.container
        .querySelectorAll<HTMLInputElement>('.trig-weekday-cb:checked')
        .forEach((cb) => checkedWeekdays.push(Number(cb.value)));

      if (freqEl) this.builderTriggerConfig.frequency = freqEl.value;
      if (onceEl) this.builderTriggerConfig.onceDateTime = onceEl.value;
      if (timeEl) this.builderTriggerConfig.time = timeEl.value;
      if (missedEl) this.builderTriggerConfig.missedPolicy = missedEl.value;
      if (domEl) this.builderTriggerConfig.dayOfMonth = Number(domEl.value) || 1;
      if (moyEl) this.builderTriggerConfig.monthOfYear = Number(moyEl.value) || 1;
      if (startEl) this.builderTriggerConfig.startDate = startEl.value;
      if (endEl) this.builderTriggerConfig.endDate = endEl.value;
      if (this.builderTriggerConfig.frequency === 'weekly') {
        this.builderTriggerConfig.weekdays =
          checkedWeekdays.length > 0 ? checkedWeekdays : [1];
      }
    } else if (this.builderTriggerType === 'hotkey') {
      const hkEl = this.container.querySelector('#trig-hotkey-input') as HTMLInputElement | null;
      if (hkEl) this.builderTriggerConfig.shortcut = hkEl.value.trim();
    } else if (this.builderTriggerType === 'startup') {
      const delayEl = this.container.querySelector(
        '#trig-startup-delay'
      ) as HTMLInputElement | null;
      const onceEl = this.container.querySelector(
        '#trig-startup-once'
      ) as HTMLInputElement | null;
      if (delayEl) this.builderTriggerConfig.delaySeconds = Number(delayEl.value) || 0;
      if (onceEl) this.builderTriggerConfig.oncePerSession = onceEl.checked;
    } else if (this.builderTriggerType === 'file_watch') {
      const folderEl = this.container.querySelector(
        '#trig-fw-folder'
      ) as HTMLInputElement | null;
      const patEl = this.container.querySelector('#trig-fw-pattern') as HTMLInputElement | null;
      const extEl = this.container.querySelector('#trig-fw-ext') as HTMLInputElement | null;
      const debEl = this.container.querySelector('#trig-fw-debounce') as HTMLInputElement | null;
      const evs: FileWatchEventType[] = [];
      this.container
        .querySelectorAll<HTMLInputElement>('.trig-fw-event-cb:checked')
        .forEach((cb) => evs.push(cb.value as FileWatchEventType));

      if (folderEl) this.builderTriggerConfig.folderPath = folderEl.value.trim();
      if (patEl) this.builderTriggerConfig.fileNamePattern = patEl.value.trim();
      if (extEl) this.builderTriggerConfig.extensionFilter = extEl.value.trim();
      if (debEl) this.builderTriggerConfig.debounceMs = Number(debEl.value) || 600;
      this.builderTriggerConfig.events = evs;
    }

    // Policy
    const polErr = this.container.querySelector(
      '#builder-policy-onerror'
    ) as HTMLSelectElement | null;
    const polTimeout = this.container.querySelector(
      '#builder-policy-timeout'
    ) as HTMLInputElement | null;
    const polRetries = this.container.querySelector(
      '#builder-policy-retries'
    ) as HTMLInputElement | null;
    const polDelay = this.container.querySelector(
      '#builder-policy-retrydelay'
    ) as HTMLInputElement | null;

    if (polErr) this.builderPolicy.onError = polErr.value === 'continue' ? 'continue' : 'stop';
    if (polTimeout) this.builderPolicy.timeoutMs = Number(polTimeout.value) || 60000;
    if (polRetries) this.builderPolicy.maxRetries = Number(polRetries.value) || 0;
    if (polDelay) this.builderPolicy.retryDelayMs = Number(polDelay.value) || 1000;
  }

  private bindBuilderEvents(): void {
    const trigTypeSel = this.container.querySelector(
      '#builder-trigger-type'
    ) as HTMLSelectElement | null;
    trigTypeSel?.addEventListener('change', () => {
      this.syncBuilderDomState();
      this.builderTriggerType = trigTypeSel.value as TriggerType;
      if (this.builderTriggerType === 'schedule') {
        this.builderTriggerConfig = {
          frequency: 'daily',
          time: '08:00',
          weekdays: [1, 2, 3, 4, 5],
          dayOfMonth: 1,
          monthOfYear: 1,
          missedPolicy: 'run_once'
        };
      } else if (this.builderTriggerType === 'hotkey') {
        this.builderTriggerConfig = { shortcut: 'CommandOrControl+Alt+W' };
      } else if (this.builderTriggerType === 'startup') {
        this.builderTriggerConfig = { delaySeconds: 3, oncePerSession: true };
      } else if (this.builderTriggerType === 'file_watch') {
        this.builderTriggerConfig = {
          folderPath: '',
          events: ['created', 'changed'],
          debounceMs: 600
        };
      }
      this.render();
    });

    const schedFreqSel = this.container.querySelector(
      '#trig-sched-freq'
    ) as HTMLSelectElement | null;
    schedFreqSel?.addEventListener('change', () => {
      this.syncBuilderDomState();
      this.render();
    });

    // Hotkey recorder on trig-hotkey-input
    const hkInput = this.container.querySelector(
      '#trig-hotkey-input'
    ) as HTMLInputElement | null;
    hkInput?.addEventListener('keydown', (e: KeyboardEvent) => {
      if (['Tab', 'Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
      e.preventDefault();
      const mods: string[] = [];
      if (e.ctrlKey || e.metaKey) mods.push('CommandOrControl');
      if (e.altKey) mods.push('Alt');
      if (e.shiftKey) mods.push('Shift');
      if (mods.length === 0) return;
      const key = e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key;
      hkInput.value = `${mods.join('+')}+${key}`;
      this.builderTriggerConfig.shortcut = hkInput.value;
    });

    // Condition group operator & add/remove condition
    const condOpSel = this.container.querySelector(
      '#builder-cond-operator'
    ) as HTMLSelectElement | null;
    condOpSel?.addEventListener('change', () => {
      this.builderConditionConfig.operator = condOpSel.value === 'OR' ? 'OR' : 'AND';
    });

    const addCondBtn = this.container.querySelector('#builder-add-condition-btn');
    addCondBtn?.addEventListener('click', () => {
      this.syncBuilderDomState();
      this.builderConditionConfig.conditions.push({
        id: `cond_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type: 'time_hour',
        operator: 'greater_than',
        target: '',
        value: '7'
      });
      this.render();
    });

    this.container.querySelectorAll<HTMLElement>('[data-remove-cond]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.syncBuilderDomState();
        const idx = Number(btn.getAttribute('data-remove-cond'));
        this.builderConditionConfig.conditions.splice(idx, 1);
        this.render();
      });
    });

    this.container.querySelectorAll<HTMLSelectElement>('.cond-type-select').forEach((sel) => {
      sel.addEventListener('change', () => {
        const idx = Number(sel.getAttribute('data-cond-idx'));
        this.builderConditionConfig.conditions[idx].type = sel.value as ConditionType;
      });
    });
    this.container.querySelectorAll<HTMLSelectElement>('.cond-op-select').forEach((sel) => {
      sel.addEventListener('change', () => {
        const idx = Number(sel.getAttribute('data-cond-idx'));
        this.builderConditionConfig.conditions[idx].operator = sel.value as ConditionOperator;
      });
    });
    this.container.querySelectorAll<HTMLInputElement>('.cond-target-input').forEach((inp) => {
      inp.addEventListener('input', () => {
        const idx = Number(inp.getAttribute('data-cond-idx'));
        this.builderConditionConfig.conditions[idx].target = inp.value;
      });
    });
    this.container.querySelectorAll<HTMLInputElement>('.cond-value-input').forEach((inp) => {
      inp.addEventListener('input', () => {
        const idx = Number(inp.getAttribute('data-cond-idx'));
        this.builderConditionConfig.conditions[idx].value = inp.value;
      });
    });

    // Actions: Add, Reorder, Duplicate, Remove, Config inputs
    const addActBtn = this.container.querySelector('#builder-add-action-btn');
    addActBtn?.addEventListener('click', () => {
      this.syncBuilderDomState();
      this.builderActions.push({
        id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type: 'show_notification',
        config: { title: 'Automation Step', body: 'Step completed' },
        onError: 'inherit',
        maxRetries: 0
      });
      this.render();
    });

    this.container.querySelectorAll<HTMLSelectElement>('.action-type-select').forEach((sel) => {
      sel.addEventListener('change', () => {
        this.syncBuilderDomState();
        const idx = Number(sel.getAttribute('data-act-idx'));
        const newType = sel.value as ActionType;
        this.builderActions[idx].type = newType;
        this.builderActions[idx].config = this.getDefaultActionConfig(newType);
        if (newType === 'if_else') {
          this.builderActions[idx].conditionGroup = {
            operator: 'AND',
            conditions: [
              {
                id: `if_c_${Date.now()}`,
                type: 'todo_incomplete_count',
                operator: 'greater_than',
                value: '0'
              }
            ]
          };
          this.builderActions[idx].thenActions = [
            {
              id: `then_${Date.now()}`,
              type: 'show_notification',
              config: { title: 'If Branch Matched', body: 'Condition evaluated TRUE' }
            }
          ];
          this.builderActions[idx].elseActions = [];
        }
        this.render();
      });
    });

    this.container.querySelectorAll<HTMLElement>('[data-move-act-up]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.syncBuilderDomState();
        const idx = Number(btn.getAttribute('data-move-act-up'));
        if (idx > 0) {
          const tmp = this.builderActions[idx - 1];
          this.builderActions[idx - 1] = this.builderActions[idx];
          this.builderActions[idx] = tmp;
          this.render();
        }
      });
    });

    this.container.querySelectorAll<HTMLElement>('[data-move-act-down]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.syncBuilderDomState();
        const idx = Number(btn.getAttribute('data-move-act-down'));
        if (idx < this.builderActions.length - 1) {
          const tmp = this.builderActions[idx + 1];
          this.builderActions[idx + 1] = this.builderActions[idx];
          this.builderActions[idx] = tmp;
          this.render();
        }
      });
    });

    this.container.querySelectorAll<HTMLElement>('[data-dup-act]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.syncBuilderDomState();
        const idx = Number(btn.getAttribute('data-dup-act'));
        const copy = JSON.parse(JSON.stringify(this.builderActions[idx])) as WorkflowActionStep;
        copy.id = `act_${Date.now()}_copy`;
        this.builderActions.splice(idx + 1, 0, copy);
        this.render();
      });
    });

    this.container.querySelectorAll<HTMLElement>('[data-remove-act]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.syncBuilderDomState();
        const idx = Number(btn.getAttribute('data-remove-act'));
        this.builderActions.splice(idx, 1);
        this.render();
      });
    });

    this.container
      .querySelectorAll<HTMLInputElement | HTMLSelectElement>('.act-cfg-input')
      .forEach((el) => {
        el.addEventListener('input', () => {
          const idx = Number(el.getAttribute('data-act-idx'));
          const key = el.getAttribute('data-cfg-key') || '';
          if (this.builderActions[idx] && key) {
            this.builderActions[idx].config[key] = el.value;
          }
        });
      });

    this.container.querySelectorAll<HTMLInputElement>('.act-cfg-checkbox').forEach((cb) => {
      cb.addEventListener('change', () => {
        const idx = Number(cb.getAttribute('data-act-idx'));
        const key = cb.getAttribute('data-cfg-key') || '';
        if (this.builderActions[idx] && key) {
          this.builderActions[idx].config[key] = cb.checked;
        }
      });
    });

    this.container.querySelectorAll<HTMLSelectElement>('.act-onerror-select').forEach((sel) => {
      sel.addEventListener('change', () => {
        const idx = Number(sel.getAttribute('data-act-idx'));
        this.builderActions[idx].onError = sel.value as 'inherit' | 'stop' | 'continue';
      });
    });

    this.container.querySelectorAll<HTMLInputElement>('.act-retries-input').forEach((inp) => {
      inp.addEventListener('input', () => {
        const idx = Number(inp.getAttribute('data-act-idx'));
        this.builderActions[idx].maxRetries = Number(inp.value) || 0;
      });
    });

    // If/else specialized inputs
    this.container.querySelectorAll<HTMLSelectElement>('.ifelse-cond-type').forEach((sel) => {
      sel.addEventListener('change', () => {
        const idx = Number(sel.getAttribute('data-act-idx'));
        const step = this.builderActions[idx];
        if (step.conditionGroup?.conditions?.[0]) {
          step.conditionGroup.conditions[0].type = sel.value as ConditionType;
        }
      });
    });
    this.container.querySelectorAll<HTMLSelectElement>('.ifelse-cond-op').forEach((sel) => {
      sel.addEventListener('change', () => {
        const idx = Number(sel.getAttribute('data-act-idx'));
        const step = this.builderActions[idx];
        if (step.conditionGroup?.conditions?.[0]) {
          step.conditionGroup.conditions[0].operator = sel.value as ConditionOperator;
        }
      });
    });
    this.container.querySelectorAll<HTMLInputElement>('.ifelse-cond-val').forEach((inp) => {
      inp.addEventListener('input', () => {
        const idx = Number(inp.getAttribute('data-act-idx'));
        const step = this.builderActions[idx];
        if (step.conditionGroup?.conditions?.[0]) {
          step.conditionGroup.conditions[0].value = inp.value;
        }
      });
    });
    this.container.querySelectorAll<HTMLInputElement>('.ifelse-then-title').forEach((inp) => {
      inp.addEventListener('input', () => {
        const idx = Number(selOrIdx(inp));
        const step = this.builderActions[idx];
        if (step.thenActions?.[0]) {
          step.thenActions[0].config.title = inp.value;
        }
      });
    });
    this.container.querySelectorAll<HTMLInputElement>('.ifelse-then-body').forEach((inp) => {
      inp.addEventListener('input', () => {
        const idx = Number(selOrIdx(inp));
        const step = this.builderActions[idx];
        if (step.thenActions?.[0]) {
          step.thenActions[0].config.body = inp.value;
        }
      });
    });

    const selOrIdx = (el: HTMLElement) => el.getAttribute('data-act-idx') || '0';

    // Save / Save & Test / Cancel
    const cancelBtn = this.container.querySelector('#builder-cancel-btn');
    cancelBtn?.addEventListener('click', () => {
      this.switchSubTab('workflows');
    });

    const saveBtn = this.container.querySelector('#builder-save-btn');
    saveBtn?.addEventListener('click', async () => {
      await this.handleSaveBuilderWorkflow(false);
    });

    const saveTestBtn = this.container.querySelector('#builder-save-test-btn');
    saveTestBtn?.addEventListener('click', async () => {
      await this.handleSaveBuilderWorkflow(true);
    });
  }

  private async handleSaveBuilderWorkflow(runTestAfterSave: boolean): Promise<void> {
    this.syncBuilderDomState();
    this.builderValidationErrors = [];

    const res = await ipcService.saveAutomationWorkflow({
      id: this.builderId,
      name: this.builderName,
      description: this.builderDescription,
      isEnabled: this.builderEnabled,
      triggerType: this.builderTriggerType,
      triggerConfig: this.builderTriggerConfig,
      conditionConfig: this.builderConditionConfig,
      actions: this.builderActions,
      executionPolicy: this.builderPolicy
    });

    if (!res.success || !res.workflow) {
      this.builderValidationErrors = res.errors || [res.message];
      toast.show(res.message, 'error');
      this.render();
      return;
    }

    toast.show(res.message, 'success');

    if (runTestAfterSave) {
      const testRes = await ipcService.runAutomationWorkflow(res.workflow.id, {
        skipConditions: true,
        isTestRun: true
      });
      toast.show(testRes.message, testRes.success ? 'success' : 'error');
      this.onDataChanged?.();
    }

    this.activeTab = 'workflows';
    await this.refresh();
  }

  private bindHistoryFilterEvents(): void {
    const applyBtn = this.container.querySelector('#hist-apply-filter-btn');
    applyBtn?.addEventListener('click', async () => {
      const wfSel = this.container.querySelector('#hist-wf-filter') as HTMLSelectElement | null;
      const stSel = this.container.querySelector(
        '#hist-status-filter'
      ) as HTMLSelectElement | null;
      const fromInp = this.container.querySelector('#hist-date-from') as HTMLInputElement | null;
      const toInp = this.container.querySelector('#hist-date-to') as HTMLInputElement | null;
      const searchInp = this.container.querySelector(
        '#hist-search-input'
      ) as HTMLInputElement | null;

      this.historyFilterWorkflowId = wfSel && wfSel.value ? Number(wfSel.value) : undefined;
      this.historyFilterStatus = (stSel?.value as 'all' | ExecutionStatus) || 'all';
      this.historyFilterDateFrom = fromInp?.value || '';
      this.historyFilterDateTo = toInp?.value || '';
      this.historyFilterSearch = searchInp?.value || '';
      this.historyPageOffset = 0;
      await this.loadHistoryPage();
    });

    const refreshBtn = this.container.querySelector('#hist-refresh-btn');
    refreshBtn?.addEventListener('click', async () => {
      await this.loadHistoryPage();
    });

    const clearAllBtn = this.container.querySelector('#hist-clear-all-btn');
    clearAllBtn?.addEventListener('click', async () => {
      const confirmed = await confirmDialog.ask({
        title: 'Clear Execution History',
        message: 'Delete all finished workflow execution records and action step logs?',
        confirmLabel: 'Clear History',
        danger: true
      });
      if (!confirmed) return;
      const res = await ipcService.clearAutomationExecutions(0);
      toast.show(res.message, 'info');
      await this.refresh();
    });
  }

  private bindSettingsEvents(): void {
    const saveBtn = this.container.querySelector('#aset-save-btn');
    saveBtn?.addEventListener('click', async () => {
      const enEl = this.container.querySelector(
        '#aset-engine-enabled'
      ) as HTMLInputElement | null;
      const notifEl = this.container.querySelector(
        '#aset-notifications-enabled'
      ) as HTMLInputElement | null;
      const maxConcEl = this.container.querySelector(
        '#aset-max-concurrent'
      ) as HTMLInputElement | null;
      const timeoutEl = this.container.querySelector(
        '#aset-default-timeout'
      ) as HTMLInputElement | null;
      const errPolEl = this.container.querySelector(
        '#aset-default-error'
      ) as HTMLSelectElement | null;
      const missedPolEl = this.container.querySelector(
        '#aset-missed-policy'
      ) as HTMLSelectElement | null;
      const retEl = this.container.querySelector(
        '#aset-retention-days'
      ) as HTMLInputElement | null;
      const debEl = this.container.querySelector(
        '#aset-fw-debounce'
      ) as HTMLInputElement | null;

      const res = await ipcService.updateAutomationSettings({
        engine_enabled: enEl ? enEl.checked : true,
        notifications_enabled: notifEl ? notifEl.checked : true,
        max_concurrent_workflows: Number(maxConcEl?.value) || 3,
        default_timeout_ms: Number(timeoutEl?.value) || 60000,
        default_error_policy: errPolEl?.value === 'continue' ? 'continue' : 'stop',
        missed_schedule_policy: (missedPolEl?.value as MissedSchedulePolicy) || 'run_once',
        history_retention_days: Number(retEl?.value) || 30,
        file_watcher_debounce_ms: Number(debEl?.value) || 600
      });

      toast.show(res.message, res.success ? 'success' : 'error');
      await this.refresh();
    });

    const addTrustedBtn = this.container.querySelector('#aset-add-trusted-btn');
    addTrustedBtn?.addEventListener('click', async () => {
      const inp = this.container.querySelector(
        '#aset-new-trusted-path'
      ) as HTMLInputElement | null;
      const rawPath = (inp?.value || '').trim();
      if (!rawPath) return;

      const nextList = Array.from(new Set([...this.settings.trusted_app_paths, rawPath]));
      const res = await ipcService.updateAutomationSettings({
        trusted_app_paths: nextList
      });
      toast.show(res.message, res.success ? 'success' : 'error');
      await this.refresh();
    });

    this.container.querySelectorAll<HTMLElement>('[data-remove-trusted-path]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const idx = Number(btn.getAttribute('data-remove-trusted-path'));
        const nextList = this.settings.trusted_app_paths.filter((_, i) => i !== idx);
        const res = await ipcService.updateAutomationSettings({
          trusted_app_paths: nextList
        });
        toast.show(res.message, res.success ? 'info' : 'error');
        await this.refresh();
      });
    });
  }

  private getDefaultActionConfig(type: ActionType): Record<string, unknown> {
    switch (type) {
      case 'open_application':
        return { executablePath: 'C:\\Windows\\System32\\notepad.exe', args: '' };
      case 'open_folder':
      case 'create_folder':
        return { folderPath: 'C:\\Users\\Public\\Documents' };
      case 'open_url':
        return { url: 'https://example.com' };
      case 'show_notification':
        return { title: 'Auto Task Bot', body: 'Automation step completed.' };
      case 'create_todo':
        return {
          title: 'Automated Todo Task',
          description: '',
          priority: 'medium',
          status: 'todo',
          category: 'Work',
          dueOffsetMinutes: 120
        };
      case 'update_todo_status':
        return { titleMatch: '', status: 'in_progress' };
      case 'complete_todo':
        return { titleMatch: '' };
      case 'create_note':
        return { title: 'Automation Note', content: '', color: 'blue', isPinned: false };
      case 'update_note':
        return { titleMatch: '', content: '', mode: 'append' };
      case 'pin_note':
        return { titleMatch: '', pinned: true };
      case 'create_reminder':
        return { title: 'Automated Reminder', offsetMinutes: 30, recurrence: 'none' };
      case 'enable_reminder':
      case 'disable_reminder':
        return { titleMatch: '' };
      case 'copy_file':
      case 'move_file':
        return { sourcePath: '', destinationPath: '', overwrite: false };
      case 'rename_file':
        return { filePath: '', newName: '', overwrite: false };
      case 'delay':
        return { delayMs: 1000 };
      case 'stop_workflow':
        return { reason: 'Stopped by workflow condition' };
      case 'if_else':
        return {};
    }
  }

  private formatTriggerBadge(wf: AutomationWorkflow): string {
    const cfg = wf.triggerConfig || {};
    if (wf.triggerType === 'schedule') {
      const freq = String(cfg.frequency || 'daily');
      const time = String(cfg.time || cfg.onceDateTime || '08:00');
      return `Schedule (${freq} @ ${time})`;
    }
    if (wf.triggerType === 'hotkey') {
      return `Hotkey (${String(cfg.shortcut || 'None')})`;
    }
    if (wf.triggerType === 'startup') {
      return `Startup (+${Number(cfg.delaySeconds || 0)}s)`;
    }
    if (wf.triggerType === 'file_watch') {
      return `File Watch (${String(cfg.folderPath || '').split(/[\\/]/).pop() || 'Folder'})`;
    }
    return wf.triggerType;
  }

  private renderStatusBadge(status: ExecutionStatus): string {
    switch (status) {
      case 'success':
        return `<span class="badge badge-emerald">Success</span>`;
      case 'failed':
        return `<span class="badge badge-danger">Failed</span>`;
      case 'running':
        return `<span class="badge badge-blue">Running</span>`;
      case 'skipped':
        return `<span class="badge badge-amber">Skipped</span>`;
      case 'cancelled':
        return `<span class="badge badge-slate">Cancelled</span>`;
      default:
        return `<span class="badge badge-slate">${this.escapeHtml(status)}</span>`;
    }
  }

  private formatDateTime(iso: string): string {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return iso;
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const hh = String(d.getHours()).padStart(2, '0');
      const min = String(d.getMinutes()).padStart(2, '0');
      const sec = String(d.getSeconds()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd} ${hh}:${min}:${sec}`;
    } catch {
      return iso;
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
