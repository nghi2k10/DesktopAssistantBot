export type ThemeMode = 'dark' | 'light';

export type NavigationPage =
  | 'dashboard'
  | 'launcher'
  | 'todo'
  | 'notes'
  | 'reminders'
  | 'calendar'
  | 'automation'
  | 'settings';

export type QuickLaunchTarget =
  | 'desktop'
  | 'downloads'
  | 'documents'
  | 'pictures'
  | 'notepad'
  | 'home';

export type TaskStatus = 'todo' | 'in_progress' | 'done';
export type TaskPriority = 'low' | 'medium' | 'high';
export type NoteColor = 'slate' | 'blue' | 'emerald' | 'amber' | 'rose' | 'purple';
export type RecurrenceType = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
export type LeapMonthPolicy = 'regular_only' | 'leap_only' | 'both';

export interface LauncherItemInfo {
  id: QuickLaunchTarget;
  label: string;
  description: string;
  category: 'folder' | 'application';
  resolvedPath: string;
}

export interface SettingRow {
  id: number;
  key: string;
  value: string;
  updated_at: string;
}

export interface AppSettings {
  theme: ThemeMode;
  global_hotkey: string;
  start_with_windows: boolean;
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

export interface TaskCategoryRow {
  id: number;
  name: string;
  color: string;
  created_at: string;
}

export interface TaskRow {
  id: number;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  category_id: number | null;
  category_name: string;
  category_color: string;
  due_at: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface TaskStats {
  total: number;
  completed: number;
  pending: number;
  todo: number;
  inProgress: number;
  overdue: number;
  completionPercentage: number;
}

export interface NoteRow {
  id: number;
  title: string;
  content: string;
  color: NoteColor;
  is_pinned: number;
  created_at: string;
  updated_at: string;
}

export interface ReminderRow {
  id: number;
  title: string;
  description: string;
  trigger_at: string;
  recurrence_type: RecurrenceType;
  recurrence_value: string | null;
  is_enabled: number;
  is_completed: number;
  last_notified_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface LunarReminderRow {
  id: number;
  title: string;
  description: string;
  lunar_day: number;
  lunar_month: number;
  leap_month_policy: LeapMonthPolicy;
  trigger_time: string;
  is_enabled: number;
  last_notified_at: string | null;
  created_at: string;
  updated_at: string;
  next_solar_date: string;
  next_trigger_at: string;
  next_lunar_year: number;
  next_is_leap: boolean;
}

export interface ReminderHistoryRow {
  id: number;
  reminder_source: 'solar' | 'lunar';
  reminder_id: number;
  title: string;
  description: string;
  scheduled_for: string;
  notified_at: string;
  was_missed: number;
}

export interface InitialAppState {
  appName: string;
  appVersion: string;
  offlineMode: boolean;
  currentHotkey: string;
  displayHotkey: string;
  settings: AppSettings;
  systemInfo: SystemAppInfo;
  launcherItems: LauncherItemInfo[];
  settingsRows: SettingRow[];
  tasks: TaskRow[];
  taskCategories: TaskCategoryRow[];
  taskStats: TaskStats;
  notes: NoteRow[];
  reminders: ReminderRow[];
  lunarReminders: LunarReminderRow[];
  reminderHistory: ReminderHistoryRow[];
}

export interface ActionResult {
  success: boolean;
  message: string;
  targetPath?: string;
}

export interface ShortcutRegistrationResult {
  success: boolean;
  accelerator: string;
  displayHotkey: string;
  message: string;
}

export interface ReminderFiredPayload {
  source: 'solar' | 'lunar';
  reminderId: number;
  title: string;
  description: string;
  scheduledFor: string;
  wasMissed: boolean;
}

// ============================================================================
// Phase 3 – Auto Task Bot & Workflow Automation Types
// ============================================================================

export type TriggerType = 'schedule' | 'hotkey' | 'startup' | 'file_watch';
export type ScheduleFrequency = 'once' | 'daily' | 'weekly' | 'monthly' | 'yearly';
export type MissedSchedulePolicy = 'skip' | 'run_once' | 'ask_user';
export type FileWatchEventType = 'created' | 'changed' | 'deleted' | 'renamed';

export type ConditionType =
  | 'time_hour'
  | 'time_weekday'
  | 'time_date'
  | 'time_date_range'
  | 'file_exists'
  | 'file_not_exists'
  | 'file_extension'
  | 'file_size'
  | 'todo_incomplete_count'
  | 'todo_completed'
  | 'todo_overdue_count'
  | 'workflow_enabled'
  | 'workflow_last_status'
  | 'workflow_is_running';

export type ConditionOperator =
  | 'equals'
  | 'not_equals'
  | 'greater_than'
  | 'less_than'
  | 'contains'
  | 'exists';

export interface ConditionRule {
  id: string;
  type: ConditionType;
  operator: ConditionOperator;
  target?: string;
  value: string;
}

export interface ConditionGroup {
  operator: 'AND' | 'OR';
  conditions: ConditionRule[];
}

export type ActionType =
  | 'open_application'
  | 'open_folder'
  | 'open_url'
  | 'show_notification'
  | 'create_todo'
  | 'update_todo_status'
  | 'complete_todo'
  | 'create_note'
  | 'update_note'
  | 'pin_note'
  | 'create_reminder'
  | 'enable_reminder'
  | 'disable_reminder'
  | 'copy_file'
  | 'move_file'
  | 'rename_file'
  | 'create_folder'
  | 'delay'
  | 'stop_workflow'
  | 'if_else';

export interface WorkflowActionStep {
  id: string;
  type: ActionType;
  name?: string;
  config: Record<string, unknown>;
  onError?: 'inherit' | 'stop' | 'continue';
  maxRetries?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
  conditionGroup?: ConditionGroup;
  thenActions?: WorkflowActionStep[];
  elseActions?: WorkflowActionStep[];
}

export interface ExecutionPolicy {
  onError: 'stop' | 'continue';
  timeoutMs: number;
  maxRetries: number;
  retryDelayMs: number;
  allowConcurrent: boolean;
}

export interface AutomationWorkflow {
  id: number;
  name: string;
  description: string;
  isEnabled: boolean;
  triggerType: TriggerType;
  triggerConfig: Record<string, unknown>;
  conditionConfig: ConditionGroup;
  actions: WorkflowActionStep[];
  executionPolicy: ExecutionPolicy;
  createdAt: string;
  updatedAt: string;
  lastExecutedAt: string | null;
  nextExecutionAt: string | null;
}

export type ExecutionStatus =
  | 'running'
  | 'success'
  | 'failed'
  | 'skipped'
  | 'cancelled';

export interface AutomationExecutionRow {
  id: number;
  automation_id: number;
  workflow_name: string;
  trigger_type: string;
  status: ExecutionStatus;
  started_at: string;
  finished_at: string | null;
  duration_ms: number;
  error_message: string | null;
  execution_context: string;
}

export interface AutomationActionLogRow {
  id: number;
  execution_id: number;
  action_index: number;
  action_type: string;
  status: ExecutionStatus;
  started_at: string;
  finished_at: string | null;
  duration_ms: number;
  input_summary: string;
  output_summary: string;
  error_message: string | null;
}

export interface AutomationSettingsMap {
  engine_enabled: boolean;
  max_concurrent_workflows: number;
  default_timeout_ms: number;
  default_error_policy: 'stop' | 'continue';
  missed_schedule_policy: MissedSchedulePolicy;
  history_retention_days: number;
  notifications_enabled: boolean;
  file_watcher_debounce_ms: number;
  trusted_app_paths: string[];
}

export interface PendingMissedApproval {
  automationId: number;
  workflowName: string;
  missedScheduledAt: string;
}

export interface AutomationDashboardStats {
  totalAutomations: number;
  enabledAutomations: number;
  disabledAutomations: number;
  runningAutomations: number;
  successfulExecutions: number;
  failedExecutions: number;
  skippedExecutions: number;
  cancelledExecutions: number;
  nextScheduledWorkflow: {
    automationId: number;
    name: string;
    nextExecutionAt: string;
  } | null;
  pendingMissedApprovals: PendingMissedApproval[];
}

export interface AutomationOverviewPayload {
  workflows: AutomationWorkflow[];
  stats: AutomationDashboardStats;
  recentExecutions: AutomationExecutionRow[];
  settings: AutomationSettingsMap;
  runningExecutionIdsByWorkflow: Record<number, number[]>;
}

export interface WorkflowImportPreview {
  valid: boolean;
  errors: string[];
  warnings: string[];
  workflows: Array<{
    name: string;
    description: string;
    triggerType: TriggerType;
    triggerConfig: Record<string, unknown>;
    conditionConfig: ConditionGroup;
    actions: WorkflowActionStep[];
    executionPolicy: ExecutionPolicy;
    hasDuplicateName: boolean;
  }>;
}

export interface AssistantBridgeApi {
  getInitialState: () => Promise<InitialAppState>;
  setTheme: (theme: ThemeMode) => Promise<{ success: boolean; theme?: ThemeMode; message: string }>;
  updateHotkey: (shortcut: string) => Promise<ShortcutRegistrationResult>;
  resetHotkey: () => Promise<ShortcutRegistrationResult>;
  setStartWithWindows: (enabled: boolean) => Promise<{ success: boolean; enabled?: boolean; message: string }>;
  quickLaunch: (target: QuickLaunchTarget) => Promise<ActionResult>;
  lockWorkstation: () => Promise<ActionResult>;
  getApplicationInfo: () => Promise<{ systemInfo: SystemAppInfo; settingsRows: SettingRow[] }>;
  hideWindow: () => Promise<{ success: boolean }>;
  exitApplication: () => Promise<{ success: boolean }>;
  onHotkeyUpdated: (callback: (payload: { accelerator: string; displayHotkey: string }) => void) => () => void;

  // Phase 2 – Todo
  getTasksData: () => Promise<{ tasks: TaskRow[]; categories: TaskCategoryRow[]; stats: TaskStats }>;
  createTask: (input: {
    title: string;
    description?: string;
    status?: TaskStatus;
    priority?: TaskPriority;
    category_id?: number | null;
    due_at?: string | null;
  }) => Promise<{ success: boolean; task?: TaskRow; stats?: TaskStats; message: string }>;
  updateTask: (
    id: number,
    input: {
      title?: string;
      description?: string;
      status?: TaskStatus;
      priority?: TaskPriority;
      category_id?: number | null;
      due_at?: string | null;
    }
  ) => Promise<{ success: boolean; task?: TaskRow; stats?: TaskStats; message: string }>;
  deleteTask: (id: number) => Promise<{ success: boolean; stats?: TaskStats; message: string }>;
  createTaskCategory: (
    name: string,
    color?: string
  ) => Promise<{ success: boolean; category?: TaskCategoryRow; categories?: TaskCategoryRow[]; message: string }>;

  // Phase 2 – Quick Notes
  getNotes: () => Promise<{ notes: NoteRow[] }>;
  createNote: (input?: {
    title?: string;
    content?: string;
    color?: NoteColor;
    is_pinned?: boolean;
  }) => Promise<{ success: boolean; note?: NoteRow; message: string }>;
  updateNote: (
    id: number,
    input: {
      title?: string;
      content?: string;
      color?: NoteColor;
      is_pinned?: boolean;
    }
  ) => Promise<{ success: boolean; note?: NoteRow; message: string }>;
  deleteNote: (id: number) => Promise<{ success: boolean; message: string }>;

  // Phase 2 – Reminders & Lunar Reminders
  getRemindersData: () => Promise<{
    reminders: ReminderRow[];
    lunarReminders: LunarReminderRow[];
    history: ReminderHistoryRow[];
  }>;
  createReminder: (input: {
    title: string;
    description?: string;
    trigger_at: string;
    recurrence_type?: RecurrenceType;
    recurrence_value?: string | null;
    is_enabled?: boolean;
  }) => Promise<{ success: boolean; reminder?: ReminderRow; message: string }>;
  updateReminder: (
    id: number,
    input: {
      title?: string;
      description?: string;
      trigger_at?: string;
      recurrence_type?: RecurrenceType;
      recurrence_value?: string | null;
      is_enabled?: boolean;
      is_completed?: boolean;
    }
  ) => Promise<{ success: boolean; reminder?: ReminderRow; message: string }>;
  deleteReminder: (id: number) => Promise<{ success: boolean; message: string }>;

  createLunarReminder: (input: {
    title: string;
    description?: string;
    lunar_day: number;
    lunar_month: number;
    leap_month_policy?: LeapMonthPolicy;
    trigger_time?: string;
    is_enabled?: boolean;
  }) => Promise<{ success: boolean; lunarReminder?: LunarReminderRow; message: string }>;
  updateLunarReminder: (
    id: number,
    input: {
      title?: string;
      description?: string;
      lunar_day?: number;
      lunar_month?: number;
      leap_month_policy?: LeapMonthPolicy;
      trigger_time?: string;
      is_enabled?: boolean;
    }
  ) => Promise<{ success: boolean; lunarReminder?: LunarReminderRow; message: string }>;
  deleteLunarReminder: (id: number) => Promise<{ success: boolean; message: string }>;
  triggerSchedulerCheck: () => Promise<{ fired: ReminderFiredPayload[] }>;
  onReminderTriggered: (callback: (payload: ReminderFiredPayload) => void) => () => void;
  onOpenReminder: (
    callback: (payload: { source: 'solar' | 'lunar'; reminderId: number }) => void
  ) => () => void;

  // Phase 3 – Auto Task Bot & Workflow Automation
  getAutomationOverview: () => Promise<AutomationOverviewPayload>;
  saveAutomationWorkflow: (input: {
    id?: number;
    name: string;
    description?: string;
    isEnabled?: boolean;
    triggerType: TriggerType;
    triggerConfig: Record<string, unknown>;
    conditionConfig: ConditionGroup;
    actions: WorkflowActionStep[];
    executionPolicy: ExecutionPolicy;
  }) => Promise<{ success: boolean; workflow?: AutomationWorkflow; errors?: string[]; message: string }>;
  toggleAutomationWorkflow: (
    id: number,
    isEnabled: boolean
  ) => Promise<{ success: boolean; workflow?: AutomationWorkflow; message: string }>;
  deleteAutomationWorkflow: (id: number) => Promise<{ success: boolean; message: string }>;
  duplicateAutomationWorkflow: (
    id: number
  ) => Promise<{ success: boolean; workflow?: AutomationWorkflow; message: string }>;
  runAutomationWorkflow: (
    id: number,
    options?: { skipConditions?: boolean; isTestRun?: boolean }
  ) => Promise<{ success: boolean; execution?: AutomationExecutionRow; message: string }>;
  cancelAutomationExecution: (
    executionId: number
  ) => Promise<{ success: boolean; message: string }>;
  retryAutomationExecution: (
    executionId: number
  ) => Promise<{ success: boolean; execution?: AutomationExecutionRow; message: string }>;
  resolveMissedScheduleApproval: (
    automationId: number,
    approveRun: boolean
  ) => Promise<{ success: boolean; message: string }>;
  getAutomationExecutions: (filter?: {
    automationId?: number;
    status?: ExecutionStatus | 'all';
    dateFrom?: string;
    dateTo?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }) => Promise<{ items: AutomationExecutionRow[]; total: number }>;
  getAutomationExecutionDetails: (executionId: number) => Promise<{
    execution: AutomationExecutionRow | null;
    actionLogs: AutomationActionLogRow[];
  }>;
  deleteAutomationExecution: (id: number) => Promise<{ success: boolean; message: string }>;
  clearAutomationExecutions: (
    olderThanDays?: number
  ) => Promise<{ success: boolean; deletedCount: number; message: string }>;
  updateAutomationSettings: (
    partial: Partial<AutomationSettingsMap>
  ) => Promise<{ success: boolean; settings?: AutomationSettingsMap; message: string }>;
  exportAutomationWorkflows: (
    automationIds?: number[]
  ) => Promise<{ success: boolean; json: string }>;
  previewImportAutomationWorkflows: (
    rawJson: string
  ) => Promise<WorkflowImportPreview>;
  importAutomationWorkflows: (
    rawJson: string
  ) => Promise<{ success: boolean; imported?: AutomationWorkflow[]; message: string }>;
  onAutomationStateChanged: (callback: () => void) => () => void;
}

declare global {
  interface Window {
    assistantApi: AssistantBridgeApi;
    __testSetTheme?: (theme: ThemeMode) => Promise<void>;
    __testNavigate?: (page: NavigationPage) => Promise<void>;
  }
}
