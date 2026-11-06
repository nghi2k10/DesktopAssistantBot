import {
  ActionResult,
  AutomationActionLogRow,
  AutomationExecutionRow,
  AutomationOverviewPayload,
  AutomationSettingsMap,
  AutomationWorkflow,
  ConditionGroup,
  ExecutionPolicy,
  ExecutionStatus,
  InitialAppState,
  LeapMonthPolicy,
  LunarReminderRow,
  NoteColor,
  NoteRow,
  QuickLaunchTarget,
  RecurrenceType,
  ReminderFiredPayload,
  ReminderHistoryRow,
  ReminderRow,
  SettingRow,
  ShortcutRegistrationResult,
  SystemAppInfo,
  TaskCategoryRow,
  TaskPriority,
  TaskRow,
  TaskStats,
  TaskStatus,
  ThemeMode,
  TriggerType,
  WorkflowActionStep,
  WorkflowImportPreview
} from '../types.js';

export const ipcService = {
  getInitialState(): Promise<InitialAppState> {
    return window.assistantApi.getInitialState();
  },

  setTheme(theme: ThemeMode): Promise<{ success: boolean; theme?: ThemeMode; message: string }> {
    return window.assistantApi.setTheme(theme);
  },

  updateHotkey(shortcut: string): Promise<ShortcutRegistrationResult> {
    return window.assistantApi.updateHotkey(shortcut);
  },

  resetHotkey(): Promise<ShortcutRegistrationResult> {
    return window.assistantApi.resetHotkey();
  },

  setStartWithWindows(enabled: boolean): Promise<{ success: boolean; enabled?: boolean; message: string }> {
    return window.assistantApi.setStartWithWindows(enabled);
  },

  quickLaunch(target: QuickLaunchTarget): Promise<ActionResult> {
    return window.assistantApi.quickLaunch(target);
  },

  lockWorkstation(): Promise<ActionResult> {
    return window.assistantApi.lockWorkstation();
  },

  getApplicationInfo(): Promise<{ systemInfo: SystemAppInfo; settingsRows: SettingRow[] }> {
    return window.assistantApi.getApplicationInfo();
  },

  hideWindow(): Promise<{ success: boolean }> {
    return window.assistantApi.hideWindow();
  },

  exitApplication(): Promise<{ success: boolean }> {
    return window.assistantApi.exitApplication();
  },

  onHotkeyUpdated(callback: (payload: { accelerator: string; displayHotkey: string }) => void): () => void {
    return window.assistantApi.onHotkeyUpdated(callback);
  },

  // Todo List
  getTasksData(): Promise<{ tasks: TaskRow[]; categories: TaskCategoryRow[]; stats: TaskStats }> {
    return window.assistantApi.getTasksData();
  },

  createTask(input: {
    title: string;
    description?: string;
    status?: TaskStatus;
    priority?: TaskPriority;
    category_id?: number | null;
    due_at?: string | null;
  }): Promise<{ success: boolean; task?: TaskRow; stats?: TaskStats; message: string }> {
    return window.assistantApi.createTask(input);
  },

  updateTask(
    id: number,
    input: {
      title?: string;
      description?: string;
      status?: TaskStatus;
      priority?: TaskPriority;
      category_id?: number | null;
      due_at?: string | null;
    }
  ): Promise<{ success: boolean; task?: TaskRow; stats?: TaskStats; message: string }> {
    return window.assistantApi.updateTask(id, input);
  },

  deleteTask(id: number): Promise<{ success: boolean; stats?: TaskStats; message: string }> {
    return window.assistantApi.deleteTask(id);
  },

  createTaskCategory(
    name: string,
    color?: string
  ): Promise<{ success: boolean; category?: TaskCategoryRow; categories?: TaskCategoryRow[]; message: string }> {
    return window.assistantApi.createTaskCategory(name, color);
  },

  // Quick Notes
  getNotes(): Promise<{ notes: NoteRow[] }> {
    return window.assistantApi.getNotes();
  },

  createNote(input?: {
    title?: string;
    content?: string;
    color?: NoteColor;
    is_pinned?: boolean;
  }): Promise<{ success: boolean; note?: NoteRow; message: string }> {
    return window.assistantApi.createNote(input);
  },

  updateNote(
    id: number,
    input: {
      title?: string;
      content?: string;
      color?: NoteColor;
      is_pinned?: boolean;
    }
  ): Promise<{ success: boolean; note?: NoteRow; message: string }> {
    return window.assistantApi.updateNote(id, input);
  },

  deleteNote(id: number): Promise<{ success: boolean; message: string }> {
    return window.assistantApi.deleteNote(id);
  },

  // Reminders & Lunar Reminders
  getRemindersData(): Promise<{
    reminders: ReminderRow[];
    lunarReminders: LunarReminderRow[];
    history: ReminderHistoryRow[];
  }> {
    return window.assistantApi.getRemindersData();
  },

  createReminder(input: {
    title: string;
    description?: string;
    trigger_at: string;
    recurrence_type?: RecurrenceType;
    recurrence_value?: string | null;
    is_enabled?: boolean;
  }): Promise<{ success: boolean; reminder?: ReminderRow; message: string }> {
    return window.assistantApi.createReminder(input);
  },

  updateReminder(
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
  ): Promise<{ success: boolean; reminder?: ReminderRow; message: string }> {
    return window.assistantApi.updateReminder(id, input);
  },

  deleteReminder(id: number): Promise<{ success: boolean; message: string }> {
    return window.assistantApi.deleteReminder(id);
  },

  createLunarReminder(input: {
    title: string;
    description?: string;
    lunar_day: number;
    lunar_month: number;
    leap_month_policy?: LeapMonthPolicy;
    trigger_time?: string;
    is_enabled?: boolean;
  }): Promise<{ success: boolean; lunarReminder?: LunarReminderRow; message: string }> {
    return window.assistantApi.createLunarReminder(input);
  },

  updateLunarReminder(
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
  ): Promise<{ success: boolean; lunarReminder?: LunarReminderRow; message: string }> {
    return window.assistantApi.updateLunarReminder(id, input);
  },

  deleteLunarReminder(id: number): Promise<{ success: boolean; message: string }> {
    return window.assistantApi.deleteLunarReminder(id);
  },

  triggerSchedulerCheck(): Promise<{ fired: ReminderFiredPayload[] }> {
    return window.assistantApi.triggerSchedulerCheck();
  },

  onReminderTriggered(callback: (payload: ReminderFiredPayload) => void): () => void {
    return window.assistantApi.onReminderTriggered(callback);
  },

  onOpenReminder(
    callback: (payload: { source: 'solar' | 'lunar'; reminderId: number }) => void
  ): () => void {
    return window.assistantApi.onOpenReminder(callback);
  },

  // Phase 3 – Auto Task Bot & Workflow Automation
  getAutomationOverview(): Promise<AutomationOverviewPayload> {
    return window.assistantApi.getAutomationOverview();
  },

  saveAutomationWorkflow(input: {
    id?: number;
    name: string;
    description?: string;
    isEnabled?: boolean;
    triggerType: TriggerType;
    triggerConfig: Record<string, unknown>;
    conditionConfig: ConditionGroup;
    actions: WorkflowActionStep[];
    executionPolicy: ExecutionPolicy;
  }): Promise<{
    success: boolean;
    workflow?: AutomationWorkflow;
    errors?: string[];
    message: string;
  }> {
    return window.assistantApi.saveAutomationWorkflow(input);
  },

  toggleAutomationWorkflow(
    id: number,
    isEnabled: boolean
  ): Promise<{ success: boolean; workflow?: AutomationWorkflow; message: string }> {
    return window.assistantApi.toggleAutomationWorkflow(id, isEnabled);
  },

  deleteAutomationWorkflow(id: number): Promise<{ success: boolean; message: string }> {
    return window.assistantApi.deleteAutomationWorkflow(id);
  },

  duplicateAutomationWorkflow(
    id: number
  ): Promise<{ success: boolean; workflow?: AutomationWorkflow; message: string }> {
    return window.assistantApi.duplicateAutomationWorkflow(id);
  },

  runAutomationWorkflow(
    id: number,
    options?: { skipConditions?: boolean; isTestRun?: boolean }
  ): Promise<{ success: boolean; execution?: AutomationExecutionRow; message: string }> {
    return window.assistantApi.runAutomationWorkflow(id, options);
  },

  cancelAutomationExecution(
    executionId: number
  ): Promise<{ success: boolean; message: string }> {
    return window.assistantApi.cancelAutomationExecution(executionId);
  },

  retryAutomationExecution(
    executionId: number
  ): Promise<{ success: boolean; execution?: AutomationExecutionRow; message: string }> {
    return window.assistantApi.retryAutomationExecution(executionId);
  },

  resolveMissedScheduleApproval(
    automationId: number,
    approveRun: boolean
  ): Promise<{ success: boolean; message: string }> {
    return window.assistantApi.resolveMissedScheduleApproval(automationId, approveRun);
  },

  getAutomationExecutions(filter?: {
    automationId?: number;
    status?: ExecutionStatus | 'all';
    dateFrom?: string;
    dateTo?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ items: AutomationExecutionRow[]; total: number }> {
    return window.assistantApi.getAutomationExecutions(filter);
  },

  getAutomationExecutionDetails(executionId: number): Promise<{
    execution: AutomationExecutionRow | null;
    actionLogs: AutomationActionLogRow[];
  }> {
    return window.assistantApi.getAutomationExecutionDetails(executionId);
  },

  deleteAutomationExecution(id: number): Promise<{ success: boolean; message: string }> {
    return window.assistantApi.deleteAutomationExecution(id);
  },

  clearAutomationExecutions(
    olderThanDays?: number
  ): Promise<{ success: boolean; deletedCount: number; message: string }> {
    return window.assistantApi.clearAutomationExecutions(olderThanDays);
  },

  updateAutomationSettings(
    partial: Partial<AutomationSettingsMap>
  ): Promise<{ success: boolean; settings?: AutomationSettingsMap; message: string }> {
    return window.assistantApi.updateAutomationSettings(partial);
  },

  exportAutomationWorkflows(
    automationIds?: number[]
  ): Promise<{ success: boolean; json: string }> {
    return window.assistantApi.exportAutomationWorkflows(automationIds);
  },

  previewImportAutomationWorkflows(rawJson: string): Promise<WorkflowImportPreview> {
    return window.assistantApi.previewImportAutomationWorkflows(rawJson);
  },

  importAutomationWorkflows(
    rawJson: string
  ): Promise<{ success: boolean; imported?: AutomationWorkflow[]; message: string }> {
    return window.assistantApi.importAutomationWorkflows(rawJson);
  },

  onAutomationStateChanged(callback: () => void): () => void {
    return window.assistantApi.onAutomationStateChanged(callback);
  }
};
