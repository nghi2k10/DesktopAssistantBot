import { contextBridge, ipcRenderer } from 'electron';

export type AllowedQuickLaunchTarget =
  | 'desktop'
  | 'downloads'
  | 'documents'
  | 'pictures'
  | 'notepad'
  | 'home';

const ALLOWED_TARGETS = new Set<string>([
  'desktop',
  'downloads',
  'documents',
  'pictures',
  'notepad',
  'home'
]);

const assistantApi = {
  // Phase 1 Core Methods
  getInitialState: () => ipcRenderer.invoke('assistant:get-initial-state'),

  setTheme: (theme: 'dark' | 'light') => {
    if (theme !== 'dark' && theme !== 'light') {
      return Promise.resolve({
        success: false,
        message: 'Invalid theme value. Expected "dark" or "light".'
      });
    }
    return ipcRenderer.invoke('assistant:set-theme', theme);
  },

  updateHotkey: (shortcut: string) => {
    if (typeof shortcut !== 'string' || shortcut.trim().length === 0 || shortcut.length > 64) {
      return Promise.resolve({
        success: false,
        accelerator: '',
        displayHotkey: '',
        message: 'Invalid shortcut string provided.'
      });
    }
    return ipcRenderer.invoke('assistant:update-hotkey', shortcut.trim());
  },

  resetHotkey: () => ipcRenderer.invoke('assistant:reset-hotkey'),

  setStartWithWindows: (enabled: boolean) => {
    if (typeof enabled !== 'boolean') {
      return Promise.resolve({
        success: false,
        message: 'Invalid boolean value for Start with Windows.'
      });
    }
    return ipcRenderer.invoke('assistant:set-start-with-windows', enabled);
  },

  quickLaunch: (target: AllowedQuickLaunchTarget) => {
    if (typeof target !== 'string' || !ALLOWED_TARGETS.has(target)) {
      return Promise.resolve({
        success: false,
        message: 'Disallowed quick launch target.'
      });
    }
    return ipcRenderer.invoke('assistant:quick-launch', target);
  },

  lockWorkstation: () => ipcRenderer.invoke('assistant:lock-workstation'),

  getApplicationInfo: () => ipcRenderer.invoke('assistant:get-app-info'),

  hideWindow: () => ipcRenderer.invoke('assistant:hide-window'),

  exitApplication: () => ipcRenderer.invoke('assistant:exit-app'),

  onHotkeyUpdated: (callback: (payload: { accelerator: string; displayHotkey: string }) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: { accelerator: string; displayHotkey: string }
    ) => {
      callback(payload);
    };
    ipcRenderer.on('assistant:hotkey-changed', listener);
    return () => {
      ipcRenderer.removeListener('assistant:hotkey-changed', listener);
    };
  },

  // Phase 2 – Module 1: Todo List
  getTasksData: () => ipcRenderer.invoke('assistant:todo:get-all'),

  createTask: (input: Record<string, unknown>) => {
    if (!input || typeof input !== 'object' || typeof input.title !== 'string') {
      return Promise.resolve({ success: false, message: 'Invalid task payload.' });
    }
    return ipcRenderer.invoke('assistant:todo:create', input);
  },

  updateTask: (id: number, input: Record<string, unknown>) => {
    if (typeof id !== 'number' || !input || typeof input !== 'object') {
      return Promise.resolve({ success: false, message: 'Invalid task update payload.' });
    }
    return ipcRenderer.invoke('assistant:todo:update', id, input);
  },

  deleteTask: (id: number) => {
    if (typeof id !== 'number') {
      return Promise.resolve({ success: false, message: 'Invalid task ID.' });
    }
    return ipcRenderer.invoke('assistant:todo:delete', id);
  },

  createTaskCategory: (name: string, color?: string) => {
    if (typeof name !== 'string' || !name.trim()) {
      return Promise.resolve({ success: false, message: 'Category name is required.' });
    }
    return ipcRenderer.invoke('assistant:todo:create-category', name.trim(), color || '#3b82f6');
  },

  // Phase 2 – Module 2: Quick Notes
  getNotes: () => ipcRenderer.invoke('assistant:notes:get-all'),

  createNote: (input?: Record<string, unknown>) =>
    ipcRenderer.invoke('assistant:notes:create', input || {}),

  updateNote: (id: number, input: Record<string, unknown>) => {
    if (typeof id !== 'number' || !input || typeof input !== 'object') {
      return Promise.resolve({ success: false, message: 'Invalid note update payload.' });
    }
    return ipcRenderer.invoke('assistant:notes:update', id, input);
  },

  deleteNote: (id: number) => {
    if (typeof id !== 'number') {
      return Promise.resolve({ success: false, message: 'Invalid note ID.' });
    }
    return ipcRenderer.invoke('assistant:notes:delete', id);
  },

  // Phase 2 – Module 3 & 4: Reminders & Lunar Reminders
  getRemindersData: () => ipcRenderer.invoke('assistant:reminders:get-all'),

  createReminder: (input: Record<string, unknown>) => {
    if (!input || typeof input !== 'object' || typeof input.title !== 'string') {
      return Promise.resolve({ success: false, message: 'Invalid reminder payload.' });
    }
    return ipcRenderer.invoke('assistant:reminders:create', input);
  },

  updateReminder: (id: number, input: Record<string, unknown>) => {
    if (typeof id !== 'number' || !input || typeof input !== 'object') {
      return Promise.resolve({ success: false, message: 'Invalid reminder update payload.' });
    }
    return ipcRenderer.invoke('assistant:reminders:update', id, input);
  },

  deleteReminder: (id: number) => {
    if (typeof id !== 'number') {
      return Promise.resolve({ success: false, message: 'Invalid reminder ID.' });
    }
    return ipcRenderer.invoke('assistant:reminders:delete', id);
  },

  createLunarReminder: (input: Record<string, unknown>) => {
    if (!input || typeof input !== 'object' || typeof input.title !== 'string') {
      return Promise.resolve({ success: false, message: 'Invalid lunar reminder payload.' });
    }
    return ipcRenderer.invoke('assistant:lunar-reminders:create', input);
  },

  updateLunarReminder: (id: number, input: Record<string, unknown>) => {
    if (typeof id !== 'number' || !input || typeof input !== 'object') {
      return Promise.resolve({ success: false, message: 'Invalid lunar reminder update payload.' });
    }
    return ipcRenderer.invoke('assistant:lunar-reminders:update', id, input);
  },

  deleteLunarReminder: (id: number) => {
    if (typeof id !== 'number') {
      return Promise.resolve({ success: false, message: 'Invalid lunar reminder ID.' });
    }
    return ipcRenderer.invoke('assistant:lunar-reminders:delete', id);
  },

  triggerSchedulerCheck: () => ipcRenderer.invoke('assistant:reminders:check-now'),

  onReminderTriggered: (
    callback: (payload: {
      source: 'solar' | 'lunar';
      reminderId: number;
      title: string;
      description: string;
      scheduledFor: string;
      wasMissed: boolean;
    }) => void
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: {
        source: 'solar' | 'lunar';
        reminderId: number;
        title: string;
        description: string;
        scheduledFor: string;
        wasMissed: boolean;
      }
    ) => {
      callback(payload);
    };
    ipcRenderer.on('assistant:reminder-triggered', listener);
    return () => {
      ipcRenderer.removeListener('assistant:reminder-triggered', listener);
    };
  },

  onOpenReminder: (
    callback: (payload: { source: 'solar' | 'lunar'; reminderId: number }) => void
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: { source: 'solar' | 'lunar'; reminderId: number }
    ) => {
      callback(payload);
    };
    ipcRenderer.on('assistant:open-reminder', listener);
    return () => {
      ipcRenderer.removeListener('assistant:open-reminder', listener);
    };
  },

  // Phase 3 – Auto Task Bot & Workflow Automation
  getAutomationOverview: () => ipcRenderer.invoke('assistant:automation:get-overview'),

  saveAutomationWorkflow: (input: Record<string, unknown>) => {
    if (!input || typeof input !== 'object') {
      return Promise.resolve({
        success: false,
        errors: ['Invalid workflow payload.'],
        message: 'Invalid workflow payload.'
      });
    }
    return ipcRenderer.invoke('assistant:automation:save', input);
  },

  toggleAutomationWorkflow: (id: number, isEnabled: boolean) => {
    if (typeof id !== 'number' || typeof isEnabled !== 'boolean') {
      return Promise.resolve({ success: false, message: 'Invalid toggle parameters.' });
    }
    return ipcRenderer.invoke('assistant:automation:toggle', id, isEnabled);
  },

  deleteAutomationWorkflow: (id: number) => {
    if (typeof id !== 'number') {
      return Promise.resolve({ success: false, message: 'Invalid workflow ID.' });
    }
    return ipcRenderer.invoke('assistant:automation:delete', id);
  },

  duplicateAutomationWorkflow: (id: number) => {
    if (typeof id !== 'number') {
      return Promise.resolve({ success: false, message: 'Invalid workflow ID.' });
    }
    return ipcRenderer.invoke('assistant:automation:duplicate', id);
  },

  runAutomationWorkflow: (
    id: number,
    options?: { skipConditions?: boolean; isTestRun?: boolean }
  ) => {
    if (typeof id !== 'number') {
      return Promise.resolve({ success: false, message: 'Invalid workflow ID.' });
    }
    return ipcRenderer.invoke('assistant:automation:run', id, options || {});
  },

  cancelAutomationExecution: (executionId: number) => {
    if (typeof executionId !== 'number') {
      return Promise.resolve({ success: false, message: 'Invalid execution ID.' });
    }
    return ipcRenderer.invoke('assistant:automation:cancel-execution', executionId);
  },

  retryAutomationExecution: (executionId: number) => {
    if (typeof executionId !== 'number') {
      return Promise.resolve({ success: false, message: 'Invalid execution ID.' });
    }
    return ipcRenderer.invoke('assistant:automation:retry-execution', executionId);
  },

  resolveMissedScheduleApproval: (automationId: number, approveRun: boolean) => {
    if (typeof automationId !== 'number' || typeof approveRun !== 'boolean') {
      return Promise.resolve({ success: false, message: 'Invalid parameters.' });
    }
    return ipcRenderer.invoke('assistant:automation:resolve-missed', automationId, approveRun);
  },

  getAutomationExecutions: (filter?: Record<string, unknown>) =>
    ipcRenderer.invoke('assistant:automation:get-executions', filter || {}),

  getAutomationExecutionDetails: (executionId: number) =>
    ipcRenderer.invoke('assistant:automation:get-execution-details', executionId),

  deleteAutomationExecution: (id: number) =>
    ipcRenderer.invoke('assistant:automation:delete-execution', id),

  clearAutomationExecutions: (olderThanDays?: number) =>
    ipcRenderer.invoke('assistant:automation:clear-executions', olderThanDays ?? 0),

  updateAutomationSettings: (partial: Record<string, unknown>) =>
    ipcRenderer.invoke('assistant:automation:update-settings', partial || {}),

  exportAutomationWorkflows: (automationIds?: number[]) =>
    ipcRenderer.invoke('assistant:automation:export-json', automationIds),

  previewImportAutomationWorkflows: (rawJson: string) =>
    ipcRenderer.invoke('assistant:automation:preview-import', String(rawJson || '')),

  importAutomationWorkflows: (rawJson: string) =>
    ipcRenderer.invoke('assistant:automation:import-json', String(rawJson || '')),

  onAutomationStateChanged: (callback: () => void) => {
    const listener = () => {
      callback();
    };
    ipcRenderer.on('assistant:automation-state-changed', listener);
    return () => {
      ipcRenderer.removeListener('assistant:automation-state-changed', listener);
    };
  }
};

contextBridge.exposeInMainWorld('assistantApi', assistantApi);
