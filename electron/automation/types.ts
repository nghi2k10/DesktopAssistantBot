export type TriggerType = 'schedule' | 'hotkey' | 'startup' | 'file_watch';

export type ScheduleFrequency = 'once' | 'daily' | 'weekly' | 'monthly' | 'yearly';

export type MissedSchedulePolicy = 'skip' | 'run_once' | 'ask_user';

export interface ScheduleTriggerConfig {
  frequency: ScheduleFrequency;
  time: string; // "HH:MM" (24h)
  onceDateTime?: string; // ISO "YYYY-MM-DDTHH:MM" when frequency === 'once'
  weekdays?: number[]; // 0 (Sun) .. 6 (Sat) when frequency === 'weekly'
  dayOfMonth?: number; // 1 .. 31 when frequency === 'monthly' or 'yearly'
  monthOfYear?: number; // 1 .. 12 when frequency === 'yearly'
  startDate?: string; // "YYYY-MM-DD"
  endDate?: string; // "YYYY-MM-DD"
  missedPolicy?: MissedSchedulePolicy;
}

export interface HotkeyTriggerConfig {
  shortcut: string; // e.g. "CommandOrControl+Alt+W" or "Ctrl+Alt+W"
}

export interface StartupTriggerConfig {
  delaySeconds: number; // 0 for immediate
  oncePerSession: boolean;
}

export type FileWatchEventType = 'created' | 'changed' | 'deleted' | 'renamed';

export interface FileWatchTriggerConfig {
  folderPath: string;
  events: FileWatchEventType[];
  fileNamePattern?: string; // substring or wildcard e.g. "*.pdf" or "report"
  extensionFilter?: string; // e.g. ".pdf,.txt"
  includeSubdirectories?: boolean;
  debounceMs?: number;
}

export type TriggerConfig =
  | ScheduleTriggerConfig
  | HotkeyTriggerConfig
  | StartupTriggerConfig
  | FileWatchTriggerConfig;

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
  target?: string; // e.g. file path, task ID, workflow ID, or end date for range
  value: string; // comparison value
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
  // For 'if_else' branching action
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

export interface AutomationRow {
  id: number;
  name: string;
  description: string;
  is_enabled: number;
  trigger_type: TriggerType;
  trigger_config: string;
  condition_config: string;
  action_config: string;
  execution_policy: string;
  created_at: string;
  updated_at: string;
  last_executed_at: string | null;
  next_execution_at: string | null;
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
