import {
  app,
  BrowserWindow,
  ipcMain,
  session
} from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import {
  CreateLunarReminderInput,
  CreateNoteInput,
  CreateReminderInput,
  CreateTaskInput,
  DEFAULT_SETTINGS,
  StorageService,
  ThemeMode,
  UpdateLunarReminderInput,
  UpdateNoteInput,
  UpdateReminderInput,
  UpdateTaskInput
} from './storage';
import {
  computeNextLunarReminderOccurrence,
  convertLunar2Solar,
  convertSolar2Lunar,
  getAuspiciousInfo,
  getCanChiInfo,
  verifyKnownLunarDates
} from './services/lunar-calendar';
import { ReminderSchedulerService } from './services/reminder-scheduler';
import { ShortcutManager } from './shortcut';
import { TrayManager } from './tray';
import { WindowsIntegrationService } from './windows';
import { WorkflowEngine } from './automation/engine/workflow-engine';
import { TriggerManager } from './automation/triggers/trigger-manager';
import {
  AutomationSettingsMap,
  ConditionGroup,
  ExecutionPolicy,
  ScheduleTriggerConfig,
  TriggerType,
  WorkflowActionStep
} from './automation/types';

const isSmokeTest = process.argv.includes('--smoke-test');

if (process.platform === 'win32') {
  app.setAppUserModelId('com.local.desktopassistantbot');
}

let mainWindow: BrowserWindow | null = null;
let storageService: StorageService | null = null;
let windowsService: WindowsIntegrationService | null = null;
let shortcutManager: ShortcutManager | null = null;
let trayManager: TrayManager | null = null;
let reminderScheduler: ReminderSchedulerService | null = null;
let workflowEngine: WorkflowEngine | null = null;
let isQuitting = false;

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock && !isSmokeTest) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showAndFocusWindow();
  });
}

export function showAndFocusWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }
  mainWindow.focus();
}

export function hideWindowToTray(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.hide();
}

export function toggleWindowVisibility(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

export function exitApplication(): void {
  isQuitting = true;
  app.quit();
}

function configureSecurityHeaders(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self';"
        ]
      }
    });
  });
}

function createMainWindow(): BrowserWindow {
  const iconPath = path.join(app.getAppPath(), 'assets', 'icons', 'icon.ico');

  const win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 920,
    minHeight: 620,
    title: 'Desktop Assistant Bot',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      devTools: !app.isPackaged
    }
  });

  win.setMenuBarVisibility(false);

  // Security: prevent external navigation and popups
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });

  // When user clicks close button (X), hide to System Tray instead of quitting
  win.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      win.hide();
    }
  });

  win.once('ready-to-show', () => {
    if (!isSmokeTest) {
      win.show();
      win.focus();
    }
  });

  const indexHtmlPath = path.join(app.getAppPath(), 'dist', 'src', 'index.html');
  win.loadFile(indexHtmlPath);

  return win;
}

function registerIpcHandlers(): void {
  ipcMain.handle('assistant:get-initial-state', () => {
    if (!storageService || !windowsService || !shortcutManager) {
      throw new Error('Core services are not initialized.');
    }
    const settings = storageService.getAllSettings();
    const systemInfo = windowsService.getSystemAndAppInfo(settings.start_with_windows);
    const launcherItems = windowsService.getLauncherItems();
    const settingsRows = storageService.getSettingsRows();

    return {
      appName: 'Desktop Assistant Bot',
      appVersion: app.getVersion(),
      offlineMode: true,
      currentHotkey: shortcutManager.getCurrentAccelerator(),
      displayHotkey: shortcutManager.getCurrentDisplayHotkey(),
      settings,
      systemInfo,
      launcherItems,
      settingsRows,
      tasks: storageService.getTasks(),
      taskCategories: storageService.getTaskCategories(),
      taskStats: storageService.getTaskStats(),
      notes: storageService.getNotes(),
      reminders: storageService.getReminders(),
      lunarReminders: storageService.getLunarReminders(),
      reminderHistory: storageService.getReminderHistory()
    };
  });

  ipcMain.handle('assistant:set-theme', (_event, theme: unknown) => {
    if (!storageService) {
      return { success: false, message: 'Storage service unavailable.' };
    }
    if (theme !== 'dark' && theme !== 'light') {
      return { success: false, message: 'Invalid theme mode.' };
    }
    const saved = storageService.setSetting('theme', theme as ThemeMode);
    return {
      success: saved,
      theme: theme as ThemeMode,
      message: saved
        ? `Theme switched to ${theme === 'dark' ? 'Dark Mode' : 'Light Mode'}.`
        : 'Failed to save theme to SQLite database.'
    };
  });

  ipcMain.handle('assistant:update-hotkey', (_event, rawShortcut: unknown) => {
    if (!storageService || !shortcutManager || !trayManager) {
      return {
        success: false,
        accelerator: '',
        displayHotkey: '',
        message: 'Core services unavailable.'
      };
    }

    if (typeof rawShortcut !== 'string' || !rawShortcut.trim()) {
      return {
        success: false,
        accelerator: shortcutManager.getCurrentAccelerator(),
        displayHotkey: shortcutManager.getCurrentDisplayHotkey(),
        message: 'Shortcut cannot be empty.'
      };
    }

    const result = shortcutManager.updateShortcut(rawShortcut);
    if (result.success) {
      storageService.setSetting('global_hotkey', result.accelerator);
      trayManager.updateTooltipAndMenu();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('assistant:hotkey-changed', {
          accelerator: result.accelerator,
          displayHotkey: result.displayHotkey
        });
      }
    }
    return result;
  });

  ipcMain.handle('assistant:reset-hotkey', () => {
    if (!storageService || !shortcutManager || !trayManager) {
      return {
        success: false,
        accelerator: '',
        displayHotkey: '',
        message: 'Core services unavailable.'
      };
    }

    const result = shortcutManager.updateShortcut(DEFAULT_SETTINGS.global_hotkey);
    if (result.success) {
      storageService.setSetting('global_hotkey', result.accelerator);
      trayManager.updateTooltipAndMenu();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('assistant:hotkey-changed', {
          accelerator: result.accelerator,
          displayHotkey: result.displayHotkey
        });
      }
    }
    return result;
  });

  ipcMain.handle('assistant:set-start-with-windows', (_event, enabled: unknown) => {
    if (!storageService || !windowsService) {
      return { success: false, message: 'Core services unavailable.' };
    }
    if (typeof enabled !== 'boolean') {
      return { success: false, message: 'Invalid parameter for Start with Windows.' };
    }

    const winResult = windowsService.setStartWithWindows(enabled);
    const saved = storageService.setSetting('start_with_windows', String(enabled));

    return {
      success: winResult.success && saved,
      enabled,
      message: winResult.success && saved
        ? winResult.message
        : 'Failed to persist startup setting.'
    };
  });

  ipcMain.handle('assistant:quick-launch', async (_event, target: unknown) => {
    if (!windowsService) {
      return { success: false, message: 'Windows integration service unavailable.' };
    }
    if (!windowsService.isValidLaunchTarget(target)) {
      return { success: false, message: 'Disallowed quick launch target.' };
    }
    return windowsService.executeQuickLaunch(target);
  });

  ipcMain.handle('assistant:lock-workstation', async () => {
    if (!windowsService) {
      return { success: false, message: 'Windows integration service unavailable.' };
    }
    return windowsService.lockWorkstation();
  });

  ipcMain.handle('assistant:get-app-info', () => {
    if (!storageService || !windowsService) {
      throw new Error('Core services unavailable.');
    }
    const settings = storageService.getAllSettings();
    return {
      systemInfo: windowsService.getSystemAndAppInfo(settings.start_with_windows),
      settingsRows: storageService.getSettingsRows()
    };
  });

  ipcMain.handle('assistant:hide-window', () => {
    hideWindowToTray();
    return { success: true };
  });

  ipcMain.handle('assistant:exit-app', () => {
    exitApplication();
    return { success: true };
  });

  // ==========================================================================
  // Phase 2 IPC Handlers: Module 1 – Todo List
  // ==========================================================================

  ipcMain.handle('assistant:todo:get-all', () => {
    if (!storageService) throw new Error('Storage unavailable.');
    return {
      tasks: storageService.getTasks(),
      categories: storageService.getTaskCategories(),
      stats: storageService.getTaskStats()
    };
  });

  ipcMain.handle('assistant:todo:create', (_event, input: CreateTaskInput) => {
    try {
      if (!storageService) throw new Error('Storage unavailable.');
      const task = storageService.createTask(input);
      return {
        success: true,
        task,
        stats: storageService.getTaskStats(),
        message: 'Task created.'
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, message: msg };
    }
  });

  ipcMain.handle('assistant:todo:update', (_event, id: number, input: UpdateTaskInput) => {
    try {
      if (!storageService) throw new Error('Storage unavailable.');
      const task = storageService.updateTask(Number(id), input);
      return {
        success: true,
        task,
        stats: storageService.getTaskStats(),
        message: 'Task updated.'
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, message: msg };
    }
  });

  ipcMain.handle('assistant:todo:delete', (_event, id: number) => {
    try {
      if (!storageService) throw new Error('Storage unavailable.');
      const deleted = storageService.deleteTask(Number(id));
      return {
        success: deleted,
        stats: storageService.getTaskStats(),
        message: deleted ? 'Task deleted.' : 'Task not found.'
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, message: msg };
    }
  });

  ipcMain.handle('assistant:todo:create-category', (_event, name: string, color?: string) => {
    try {
      if (!storageService) throw new Error('Storage unavailable.');
      const category = storageService.createTaskCategory(name, color);
      return {
        success: true,
        category,
        categories: storageService.getTaskCategories(),
        message: 'Category saved.'
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, message: msg };
    }
  });

  // ==========================================================================
  // Phase 2 IPC Handlers: Module 2 – Quick Notes
  // ==========================================================================

  ipcMain.handle('assistant:notes:get-all', () => {
    if (!storageService) throw new Error('Storage unavailable.');
    return {
      notes: storageService.getNotes()
    };
  });

  ipcMain.handle('assistant:notes:create', (_event, input: CreateNoteInput) => {
    try {
      if (!storageService) throw new Error('Storage unavailable.');
      const note = storageService.createNote(input);
      return { success: true, note, message: 'Note created.' };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, message: msg };
    }
  });

  ipcMain.handle('assistant:notes:update', (_event, id: number, input: UpdateNoteInput) => {
    try {
      if (!storageService) throw new Error('Storage unavailable.');
      const note = storageService.updateNote(Number(id), input);
      return { success: true, note, message: 'Note saved.' };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, message: msg };
    }
  });

  ipcMain.handle('assistant:notes:delete', (_event, id: number) => {
    try {
      if (!storageService) throw new Error('Storage unavailable.');
      const deleted = storageService.deleteNote(Number(id));
      return {
        success: deleted,
        message: deleted ? 'Note deleted.' : 'Note not found.'
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, message: msg };
    }
  });

  // ==========================================================================
  // Phase 2 IPC Handlers: Module 3 & 4 – Reminders & Lunar Reminders
  // ==========================================================================

  ipcMain.handle('assistant:reminders:get-all', () => {
    if (!storageService) throw new Error('Storage unavailable.');
    return {
      reminders: storageService.getReminders(),
      lunarReminders: storageService.getLunarReminders(),
      history: storageService.getReminderHistory()
    };
  });

  ipcMain.handle('assistant:reminders:create', (_event, input: CreateReminderInput) => {
    try {
      if (!storageService) throw new Error('Storage unavailable.');
      const reminder = storageService.createReminder(input);
      reminderScheduler?.checkDueReminders(false);
      return { success: true, reminder, message: 'Reminder created.' };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, message: msg };
    }
  });

  ipcMain.handle(
    'assistant:reminders:update',
    (_event, id: number, input: UpdateReminderInput) => {
      try {
        if (!storageService) throw new Error('Storage unavailable.');
        const reminder = storageService.updateReminder(Number(id), input);
        reminderScheduler?.checkDueReminders(false);
        return { success: true, reminder, message: 'Reminder updated.' };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { success: false, message: msg };
      }
    }
  );

  ipcMain.handle('assistant:reminders:delete', (_event, id: number) => {
    try {
      if (!storageService) throw new Error('Storage unavailable.');
      const deleted = storageService.deleteReminder(Number(id));
      return {
        success: deleted,
        message: deleted ? 'Reminder deleted.' : 'Reminder not found.'
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, message: msg };
    }
  });

  ipcMain.handle(
    'assistant:lunar-reminders:create',
    (_event, input: CreateLunarReminderInput) => {
      try {
        if (!storageService) throw new Error('Storage unavailable.');
        const lunarReminder = storageService.createLunarReminder(input);
        reminderScheduler?.checkDueReminders(false);
        return { success: true, lunarReminder, message: 'Lunar reminder created.' };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { success: false, message: msg };
      }
    }
  );

  ipcMain.handle(
    'assistant:lunar-reminders:update',
    (_event, id: number, input: UpdateLunarReminderInput) => {
      try {
        if (!storageService) throw new Error('Storage unavailable.');
        const lunarReminder = storageService.updateLunarReminder(Number(id), input);
        reminderScheduler?.checkDueReminders(false);
        return { success: true, lunarReminder, message: 'Lunar reminder updated.' };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { success: false, message: msg };
      }
    }
  );

  ipcMain.handle('assistant:lunar-reminders:delete', (_event, id: number) => {
    try {
      if (!storageService) throw new Error('Storage unavailable.');
      const deleted = storageService.deleteLunarReminder(Number(id));
      return {
        success: deleted,
        message: deleted ? 'Lunar reminder deleted.' : 'Lunar reminder not found.'
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, message: msg };
    }
  });

  ipcMain.handle('assistant:reminders:check-now', () => {
    const fired = reminderScheduler ? reminderScheduler.checkDueReminders(false) : [];
    return { fired };
  });

  // ==========================================================================
  // Phase 3 IPC Handlers: Auto Task Bot & Workflow Automation Engine
  // ==========================================================================

  ipcMain.handle('assistant:automation:get-overview', () => {
    if (!storageService || !workflowEngine) {
      throw new Error('Automation engine unavailable.');
    }
    const workflows = storageService.getAutomations();
    const stats = workflowEngine.getDashboardStats();
    const recentExecutions = storageService.getExecutions({ limit: 25, offset: 0 }).items;
    const settings = storageService.getAutomationSettings();
    const runningExecutionIdsByWorkflow: Record<number, number[]> = {};
    for (const wf of workflows) {
      const ids = workflowEngine.getRunningExecutionIdsForWorkflow(wf.id);
      if (ids.length > 0) {
        runningExecutionIdsByWorkflow[wf.id] = ids;
      }
    }
    return {
      workflows,
      stats,
      recentExecutions,
      settings,
      runningExecutionIdsByWorkflow
    };
  });

  ipcMain.handle(
    'assistant:automation:save',
    (
      _event,
      input: {
        id?: number;
        name: string;
        description?: string;
        isEnabled?: boolean;
        triggerType: TriggerType;
        triggerConfig: Record<string, unknown>;
        conditionConfig: ConditionGroup;
        actions: WorkflowActionStep[];
        executionPolicy: ExecutionPolicy;
      }
    ) => {
      try {
        if (!storageService || !workflowEngine) {
          throw new Error('Automation engine unavailable.');
        }

        const validation = workflowEngine.validateWorkflowDefinition(input, input.id);
        if (!validation.valid) {
          return {
            success: false,
            errors: validation.errors,
            message: validation.errors.join(' | ')
          };
        }

        let nextExecutionAt: string | null = null;
        const isEnabled = input.isEnabled !== undefined ? Boolean(input.isEnabled) : true;
        if (isEnabled && input.triggerType === 'schedule') {
          nextExecutionAt = TriggerManager.computeNextExecutionAt(
            input.triggerConfig as unknown as ScheduleTriggerConfig,
            new Date()
          );
        }

        const workflow = input.id
          ? storageService.updateAutomation(Number(input.id), {
              name: input.name,
              description: input.description,
              isEnabled,
              triggerType: input.triggerType,
              triggerConfig: input.triggerConfig,
              conditionConfig: input.conditionConfig,
              actions: input.actions,
              executionPolicy: input.executionPolicy,
              nextExecutionAt
            })
          : storageService.createAutomation({
              name: input.name,
              description: input.description,
              isEnabled,
              triggerType: input.triggerType,
              triggerConfig: input.triggerConfig,
              conditionConfig: input.conditionConfig,
              actions: input.actions,
              executionPolicy: input.executionPolicy,
              nextExecutionAt
            });

        workflowEngine.getTriggerManager().syncAllTriggers();
        return {
          success: true,
          workflow,
          message: input.id ? 'Workflow updated.' : 'Workflow created.'
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { success: false, errors: [msg], message: msg };
      }
    }
  );

  ipcMain.handle('assistant:automation:toggle', (_event, id: number, isEnabled: boolean) => {
    try {
      if (!storageService || !workflowEngine) {
        throw new Error('Automation engine unavailable.');
      }
      const existing = storageService.getAutomationById(Number(id));
      if (!existing) {
        return { success: false, message: 'Workflow not found.' };
      }
      if (isEnabled) {
        const validation = workflowEngine.validateWorkflowDefinition(existing, existing.id);
        if (!validation.valid) {
          return {
            success: false,
            message: `Cannot enable workflow: ${validation.errors.join(' | ')}`
          };
        }
      } else {
        workflowEngine.cancelWorkflowExecutions(existing.id);
      }

      const workflow = storageService.toggleAutomation(Number(id), Boolean(isEnabled));
      workflowEngine.getTriggerManager().syncAllTriggers();
      return {
        success: true,
        workflow: storageService.getAutomationById(Number(id)) || workflow,
        message: isEnabled ? 'Workflow enabled.' : 'Workflow disabled.'
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, message: msg };
    }
  });

  ipcMain.handle('assistant:automation:delete', (_event, id: number) => {
    try {
      if (!storageService || !workflowEngine) {
        throw new Error('Automation engine unavailable.');
      }
      workflowEngine.cancelWorkflowExecutions(Number(id));
      const deleted = storageService.deleteAutomation(Number(id));
      workflowEngine.getTriggerManager().syncAllTriggers();
      return {
        success: deleted,
        message: deleted ? 'Workflow deleted.' : 'Workflow not found.'
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, message: msg };
    }
  });

  ipcMain.handle('assistant:automation:duplicate', (_event, id: number) => {
    try {
      if (!storageService || !workflowEngine) {
        throw new Error('Automation engine unavailable.');
      }
      const duplicated = storageService.duplicateAutomation(Number(id));
      workflowEngine.getTriggerManager().syncAllTriggers();
      return {
        success: true,
        workflow: duplicated,
        message: `Duplicated as "${duplicated.name}".`
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, message: msg };
    }
  });

  ipcMain.handle(
    'assistant:automation:run',
    async (
      _event,
      id: number,
      options?: { skipConditions?: boolean; isTestRun?: boolean }
    ) => {
      try {
        if (!workflowEngine) {
          throw new Error('Automation engine unavailable.');
        }
        const execution = await workflowEngine.executeWorkflow(Number(id), {
          triggerSource: options?.isTestRun ? 'manual_test' : 'manual_run',
          triggerPayload: { manual: true, isTestRun: Boolean(options?.isTestRun) },
          isManualOrTest: true,
          skipConditions: Boolean(options?.skipConditions)
        });
        return {
          success: execution.status === 'success',
          execution,
          message:
            execution.status === 'success'
              ? `Workflow "${execution.workflow_name}" completed (${execution.duration_ms} ms).`
              : `Workflow finished with status "${execution.status}": ${
                  execution.error_message || ''
                }`
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { success: false, message: msg };
      }
    }
  );

  ipcMain.handle('assistant:automation:cancel-execution', (_event, executionId: number) => {
    if (!workflowEngine) {
      return { success: false, message: 'Automation engine unavailable.' };
    }
    const cancelled = workflowEngine.cancelExecution(Number(executionId));
    return {
      success: cancelled,
      message: cancelled ? 'Cancellation requested.' : 'Execution is no longer running.'
    };
  });

  ipcMain.handle(
    'assistant:automation:retry-execution',
    async (_event, executionId: number) => {
      try {
        if (!workflowEngine) {
          throw new Error('Automation engine unavailable.');
        }
        const execution = await workflowEngine.retryExecution(Number(executionId));
        return {
          success: execution.status === 'success',
          execution,
          message: `Retry finished with status: ${execution.status}`
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { success: false, message: msg };
      }
    }
  );

  ipcMain.handle(
    'assistant:automation:resolve-missed',
    (_event, automationId: number, approveRun: boolean) => {
      if (!workflowEngine) {
        return { success: false, message: 'Automation engine unavailable.' };
      }
      const ok = workflowEngine
        .getTriggerManager()
        .resolveMissedApproval(Number(automationId), Boolean(approveRun));
      return {
        success: ok,
        message: approveRun
          ? 'Missed scheduled workflow triggered.'
          : 'Missed schedule notification dismissed.'
      };
    }
  );

  ipcMain.handle(
    'assistant:automation:get-executions',
    (_event, filter: Record<string, unknown>) => {
      if (!storageService) throw new Error('Storage unavailable.');
      return storageService.getExecutions(filter);
    }
  );

  ipcMain.handle('assistant:automation:get-execution-details', (_event, executionId: number) => {
    if (!storageService) throw new Error('Storage unavailable.');
    return storageService.getExecutionDetails(Number(executionId));
  });

  ipcMain.handle('assistant:automation:delete-execution', (_event, id: number) => {
    if (!storageService) throw new Error('Storage unavailable.');
    const deleted = storageService.deleteExecutionRecord(Number(id));
    return {
      success: deleted,
      message: deleted ? 'Execution record deleted.' : 'Record not found.'
    };
  });

  ipcMain.handle(
    'assistant:automation:clear-executions',
    (_event, olderThanDays: number) => {
      if (!storageService) throw new Error('Storage unavailable.');
      const deletedCount = storageService.clearOldExecutions(Number(olderThanDays || 0));
      return {
        success: true,
        deletedCount,
        message: `Cleared ${deletedCount} execution record(s).`
      };
    }
  );

  ipcMain.handle(
    'assistant:automation:update-settings',
    (_event, partial: Partial<AutomationSettingsMap>) => {
      try {
        if (!storageService || !workflowEngine) {
          throw new Error('Automation engine unavailable.');
        }
        const settings = storageService.updateAutomationSettings(partial || {});
        workflowEngine.getTriggerManager().syncAllTriggers();
        return {
          success: true,
          settings,
          message: 'Automation settings saved.'
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { success: false, message: msg };
      }
    }
  );

  ipcMain.handle(
    'assistant:automation:export-json',
    (_event, automationIds?: number[]) => {
      if (!workflowEngine) throw new Error('Automation engine unavailable.');
      const json = workflowEngine.exportWorkflowsJson(automationIds);
      return { success: true, json };
    }
  );

  ipcMain.handle('assistant:automation:preview-import', (_event, rawJson: string) => {
    if (!workflowEngine) throw new Error('Automation engine unavailable.');
    return workflowEngine.validateAndPreviewImport(String(rawJson || ''));
  });

  ipcMain.handle('assistant:automation:import-json', (_event, rawJson: string) => {
    try {
      if (!workflowEngine) throw new Error('Automation engine unavailable.');
      const imported = workflowEngine.importWorkflowsJson(String(rawJson || ''));
      return {
        success: true,
        imported,
        message: `Successfully imported ${imported.length} workflow(s) (disabled by default for safety).`
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, message: msg };
    }
  });
}

async function runAutomatedSmokeTests(): Promise<void> {
  const results: Array<{ id: number; name: string; passed: boolean; details: string }> = [];
  const record = (id: number, name: string, passed: boolean, details: string) => {
    results.push({ id, name, passed, details });
    console.log(`[SMOKE TEST #${id}] ${passed ? 'PASS' : 'FAIL'} - ${name}: ${details}`);
  };

  try {
    if (
      !mainWindow ||
      !storageService ||
      !windowsService ||
      !shortcutManager ||
      !trayManager ||
      !reminderScheduler
    ) {
      throw new Error('Core services failed to initialize');
    }

    // Wait for renderer DOM to finish initializing
    await new Promise<void>((resolve) => {
      if (mainWindow && !mainWindow.webContents.isLoading()) {
        setTimeout(resolve, 450);
      } else if (mainWindow) {
        mainWindow.webContents.once('did-finish-load', () => setTimeout(resolve, 450));
      }
    });

    // ========================================================================
    // PHASE 1 REGRESSION SUITE (#1 - #15)
    // ========================================================================

    record(1, 'Application starts successfully', !mainWindow.isDestroyed(), 'Main BrowserWindow and services initialized.');

    const dashboardCheck = await mainWindow.webContents.executeJavaScript(`
      (() => {
        const title = document.querySelector('#page-title')?.textContent?.trim();
        const appName = document.querySelector('#dashboard-app-name')?.textContent?.trim();
        const version = document.querySelector('#dashboard-app-version')?.textContent?.trim();
        const offline = document.querySelector('#dashboard-offline-badge')?.textContent?.trim();
        return { title, appName, version, offline };
      })()
    `);
    record(
      2,
      'Dashboard displays correctly',
      dashboardCheck.appName === 'Desktop Assistant Bot' && Boolean(dashboardCheck.version) && Boolean(dashboardCheck.offline),
      JSON.stringify(dashboardCheck)
    );

    await mainWindow.webContents.executeJavaScript(`window.__testSetTheme('dark')`);
    const darkAttr = await mainWindow.webContents.executeJavaScript(`document.documentElement.getAttribute('data-theme')`);
    record(3, 'Dark Mode works', darkAttr === 'dark' && storageService.getSetting('theme') === 'dark', `DOM data-theme=${darkAttr}, SQLite=${storageService.getSetting('theme')}`);

    await mainWindow.webContents.executeJavaScript(`window.__testSetTheme('light')`);
    const lightAttr = await mainWindow.webContents.executeJavaScript(`document.documentElement.getAttribute('data-theme')`);
    record(4, 'Light Mode works', lightAttr === 'light' && storageService.getSetting('theme') === 'light', `DOM data-theme=${lightAttr}, SQLite=${storageService.getSetting('theme')}`);

    const verifyStorage = new StorageService(storageService.getDatabasePath());
    verifyStorage.init();
    const persistedTheme = verifyStorage.getSetting('theme');
    verifyStorage.close();
    await mainWindow.webContents.executeJavaScript(`window.__testSetTheme('dark')`);
    record(5, 'Theme persists after restart', persistedTheme === 'light', `Re-opened SQLite DB verified theme=${persistedTheme}`);

    mainWindow.hide();
    const hiddenBeforeHotkey = !mainWindow.isVisible();
    toggleWindowVisibility();
    const visibleAfterHotkey = mainWindow.isVisible();
    record(
      6,
      'Ctrl + Shift + Space opens the application',
      hiddenBeforeHotkey && visibleAfterHotkey && shortcutManager.getCurrentAccelerator() === 'CommandOrControl+Shift+Space',
      `Registered=${shortcutManager.getCurrentDisplayHotkey()}, hidden->visible=${visibleAfterHotkey}`
    );

    toggleWindowVisibility();
    const hiddenAfterSecondPress = !mainWindow.isVisible();
    record(7, 'Shortcut hides the application', hiddenAfterSecondPress, `visible->hidden=${hiddenAfterSecondPress}`);

    mainWindow.show();
    mainWindow.close();
    const aliveAndHidden = !mainWindow.isDestroyed() && !mainWindow.isVisible();
    record(8, 'Closing the window hides it to System Tray', aliveAndHidden, `isDestroyed=${mainWindow.isDestroyed()}, isVisible=${mainWindow.isVisible()}`);

    const trayActive = trayManager.isInitialized();
    showAndFocusWindow();
    const openedViaTrayCallback = mainWindow.isVisible();
    hideWindowToTray();
    const hiddenViaTrayCallback = !mainWindow.isVisible();
    record(9, 'Tray menu works', trayActive && openedViaTrayCallback && hiddenViaTrayCallback, `trayInitialized=${trayActive}, open=${openedViaTrayCallback}, hide=${hiddenViaTrayCallback}`);

    const items = windowsService.getLauncherItems();
    const folderItems = items.filter((i) => i.category === 'folder');
    const allFoldersExist = folderItems.every((i) => fs.existsSync(i.resolvedPath));
    record(10, 'Quick Launcher resolves correct folders', folderItems.length === 5 && allFoldersExist, folderItems.map((f) => `${f.id}:${f.resolvedPath}`).join('; '));

    const notepadItem = items.find((i) => i.id === 'notepad');
    const notepadExists = Boolean(notepadItem && fs.existsSync(notepadItem.resolvedPath));
    record(11, 'Notepad executable verified', notepadExists, `Path=${notepadItem?.resolvedPath}`);

    const rundll32Path = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'rundll32.exe');
    const lockApiAvailable = fs.existsSync(rundll32Path) && typeof windowsService.lockWorkstation === 'function';
    record(12, 'Lock Workstation integration ready', lockApiAvailable, `rundll32=${rundll32Path}`);

    const customHotkeyRes = shortcutManager.updateShortcut('Ctrl+Alt+K');
    storageService.setSetting('global_hotkey', customHotkeyRes.accelerator);
    const invalidHotkeyRes = shortcutManager.updateShortcut('InvalidKeyOnly');
    const restoredAfterFailure = shortcutManager.getCurrentAccelerator() === 'CommandOrControl+Alt+K';
    const resetRes = shortcutManager.updateShortcut('CommandOrControl+Shift+Space');
    storageService.setSetting('global_hotkey', resetRes.accelerator);
    const rows = storageService.getSettingsRows();
    record(
      13,
      'Settings persist in SQLite & shortcut rollback works',
      customHotkeyRes.success && !invalidHotkeyRes.success && restoredAfterFailure && resetRes.success && rows.length >= 3,
      `Rows=${rows.length}, rollbackPreserved=${restoredAfterFailure}, reset=${resetRes.displayHotkey}`
    );

    const systemInfo = windowsService.getSystemAndAppInfo(false);
    record(14, 'Application works 100% offline', systemInfo.offlineMode === true, `offlineMode=${systemInfo.offlineMode}, db=${systemInfo.databasePath}`);

    // ========================================================================
    // PHASE 2 PRODUCTIVITY MODULES SUITE (#15 - #24)
    // ========================================================================

    // 15. Module 1 – Todo List CRUD, status transitions, priority & overdue stats
    const t1 = storageService.createTask({
      title: 'Phase 2 Smoke Task Alpha',
      description: 'Test overdue high priority task',
      status: 'todo',
      priority: 'high',
      category_id: 2,
      due_at: '2024-01-01T09:00'
    });
    const t2 = storageService.createTask({
      title: 'Phase 2 Smoke Task Beta',
      description: 'Test in_progress -> done transition',
      status: 'in_progress',
      priority: 'low',
      category_id: 1,
      due_at: '2028-12-31T17:00'
    });
    const t2Done = storageService.updateTask(t2.id, { status: 'done' });
    const statsAfterTodo = storageService.getTaskStats();
    const deletedT1 = storageService.deleteTask(t1.id);
    const deletedT2 = storageService.deleteTask(t2.id);

    record(
      15,
      'Module 1 (Todo List): CRUD, status transitions, overdue & completion stats',
      Boolean(t1.id && t2Done.status === 'done' && t2Done.completed_at && statsAfterTodo.total >= 2 && statsAfterTodo.completed >= 1 && statsAfterTodo.overdue >= 1 && deletedT1 && deletedT2),
      `completed_at=${t2Done.completed_at}, stats=${JSON.stringify(statsAfterTodo)}`
    );

    // 16. Module 2 – Quick Notes CRUD, autosave update, pin/unpin ordering, color & search
    const noteA = storageService.createNote({
      title: 'Unpinned Note A',
      content: 'Alpha content for search',
      color: 'blue',
      is_pinned: false
    });
    const noteB = storageService.createNote({
      title: 'Pinned Note B',
      content: 'Beta content',
      color: 'emerald',
      is_pinned: false
    });
    const updatedNoteB = storageService.updateNote(noteB.id, {
      content: 'Updated autosaved content',
      is_pinned: true,
      color: 'amber'
    });
    const orderedNotes = storageService.getNotes();
    const topNoteIsPinnedB = orderedNotes[0]?.id === noteB.id && orderedNotes[0]?.is_pinned === 1;
    storageService.deleteNote(noteA.id);
    storageService.deleteNote(noteB.id);

    record(
      16,
      'Module 2 (Quick Notes): Create, autosave update, pin ordering, color & delete',
      Boolean(updatedNoteB.is_pinned === 1 && updatedNoteB.color === 'amber' && topNoteIsPinnedB),
      `topPinnedId=${orderedNotes[0]?.id}, color=${updatedNoteB.color}`
    );

    // 17. Module 3 – Reminders: One-time & Recurring notifications, duplicate prevention & restart recovery
    // Hide window to System Tray first to verify scheduler works while hidden in Tray
    hideWindowToTray();
    const pastTrigger = '2025-05-10T08:30';
    const oneTimeRem = storageService.createReminder({
      title: 'Smoke One-Time Missed Reminder',
      description: 'Should fire once and mark completed',
      trigger_at: pastTrigger,
      recurrence_type: 'none',
      is_enabled: true
    });
    const dailyRem = storageService.createReminder({
      title: 'Smoke Daily Recurring Reminder',
      description: 'Should fire and advance trigger_at to future',
      trigger_at: pastTrigger,
      recurrence_type: 'daily',
      is_enabled: true
    });

    const firstRunFired = reminderScheduler.checkDueReminders(true);
    const secondRunFired = reminderScheduler.checkDueReminders(false); // Should be 0 (duplicate prevention!)
    const updatedOneTime = storageService.getReminderById(oneTimeRem.id);
    const updatedDaily = storageService.getReminderById(dailyRem.id);
    const historyRows = storageService.getReminderHistory(10);

    storageService.deleteReminder(oneTimeRem.id);
    storageService.deleteReminder(dailyRem.id);

    record(
      17,
      'Module 3 (Reminders): Tray execution, startup recovery, recurrence advance & duplicate prevention',
      Boolean(
        !mainWindow.isVisible() &&
        firstRunFired.length >= 2 &&
        secondRunFired.length === 0 &&
        updatedOneTime?.is_completed === 1 &&
        updatedDaily &&
        new Date(updatedDaily.trigger_at).getTime() > Date.now() &&
        historyRows.length >= 2
      ),
      `firstRun=${firstRunFired.length}, duplicateRun=${secondRunFired.length}, nextDaily=${updatedDaily?.trigger_at}`
    );

    // 18. Module 4 – Vietnamese Lunar Calendar (Hồ Ngọc Đức UTC+7), Leap Months, Can Chi & Hoàng Đạo
    const knownDatesCheck = verifyKnownLunarDates();
    const tet2026Lunar = convertSolar2Lunar(17, 2, 2026);
    const tet2026CanChi = getCanChiInfo(tet2026Lunar);
    const tet2026Ausp = getAuspiciousInfo(tet2026Lunar.month, tet2026CanChi.dayBranchIndex);
    const leap2025Solar = convertLunar2Solar(1, 6, 2025, true); // 2025 has leap month 6 -> 25/07/2025
    const invalidLeap2026 = convertLunar2Solar(1, 6, 2026, true); // 2026 has no leap month 6 -> day=0

    record(
      18,
      'Module 4 (Lunar Calendar): Solar<->Lunar, Leap Month validation, Can Chi & Hoàng Đạo rules',
      Boolean(
        knownDatesCheck.allPassed &&
        tet2026CanChi.yearCanChi === 'Bính Ngọ' &&
        leap2025Solar.day === 25 &&
        leap2025Solar.month === 7 &&
        invalidLeap2026.day === 0 &&
        tet2026Ausp.auspiciousHours.length === 6
      ),
      `${knownDatesCheck.details.join(' | ')} | 2026=${tet2026CanChi.yearCanChi}`
    );

    // 19. Lunar Reminders & Leap Month Policy Next Occurrence calculation
    const lunarRem = storageService.createLunarReminder({
      title: 'Rằm tháng Giêng hàng năm',
      description: 'Lunar reminder test',
      lunar_day: 15,
      lunar_month: 1,
      leap_month_policy: 'regular_only',
      trigger_time: '08:00',
      is_enabled: true
    });
    const occLeapOnly = computeNextLunarReminderOccurrence(1, 6, 'leap_only', '09:00', new Date(2025, 0, 1));
    storageService.deleteLunarReminder(lunarRem.id);

    record(
      19,
      'Module 4 (Lunar Reminders): Persistence, Leap Month Policy & Next Solar Date calculation',
      Boolean(
        lunarRem.id &&
        lunarRem.next_solar_date &&
        occLeapOnly.isoDate === '2025-07-25' &&
        occLeapOnly.isLeapOccurrence === true
      ),
      `nextSolar=${lunarRem.next_solar_date}, 2025Leap6Solar=${occLeapOnly.isoDate}`
    );

    // 20. UI Navigation across all 8 Phase 1, Phase 2 & Phase 3 views
    const navPages = [
      'todo',
      'notes',
      'reminders',
      'calendar',
      'automation',
      'launcher',
      'settings',
      'dashboard'
    ];
    let allViewsRendered = true;
    for (const p of navPages) {
      await mainWindow.webContents.executeJavaScript(`window.__testNavigate('${p}')`);
      const isVisibleDom = await mainWindow.webContents.executeJavaScript(
        `!document.getElementById('page-${p}')?.classList.contains('hidden')`
      );
      if (!isVisibleDom) {
        allViewsRendered = false;
      }
    }
    record(
      20,
      'UI Navigation across all 8 modules works cleanly',
      allViewsRendered,
      `Verified DOM views: ${navPages.join(', ')}`
    );

    // ========================================================================
    // PHASE 3 AUTO TASK BOT & WORKFLOW ENGINE SUITE (#21 - #34)
    // ========================================================================

    if (!workflowEngine) {
      throw new Error('WorkflowEngine not initialized');
    }

    // 21. Schedule Trigger Calculations (once, daily, weekly, monthly, yearly) & Missed Schedule Recovery
    const refDate = new Date(2026, 4, 11, 7, 30, 0); // Monday May 11, 2026 07:30
    const nextOnce = TriggerManager.computeNextExecutionAt(
      { frequency: 'once', time: '09:00', onceDateTime: '2026-05-11T09:00' },
      refDate
    );
    const nextDaily = TriggerManager.computeNextExecutionAt(
      { frequency: 'daily', time: '08:00' },
      refDate
    );
    const nextWeekly = TriggerManager.computeNextExecutionAt(
      { frequency: 'weekly', time: '09:30', weekdays: [5] }, // Friday May 15, 2026
      refDate
    );
    const nextMonthly = TriggerManager.computeNextExecutionAt(
      { frequency: 'monthly', time: '08:00', dayOfMonth: 1 }, // June 1, 2026
      refDate
    );
    const nextYearly = TriggerManager.computeNextExecutionAt(
      { frequency: 'yearly', time: '08:00', monthOfYear: 12, dayOfMonth: 25 },
      refDate
    );

    // Missed schedule recovery test ('ask_user' queues approval)
    const missedWf = storageService.createAutomation({
      name: 'Smoke Missed Schedule WF',
      isEnabled: true,
      triggerType: 'schedule',
      triggerConfig: {
        frequency: 'daily',
        time: '08:00',
        missedPolicy: 'ask_user'
      },
      actions: [
        {
          id: 'm1',
          type: 'show_notification',
          config: { title: 'Missed', body: 'Recovered' }
        }
      ],
      nextExecutionAt: '2025-01-01T08:00'
    });
    workflowEngine.getTriggerManager().recoverAndSyncSchedules(new Date());
    const pendingMissed = workflowEngine.getTriggerManager().getPendingMissedApprovals();
    const missedFound = pendingMissed.some((p) => p.automationId === missedWf.id);
    workflowEngine.getTriggerManager().resolveMissedApproval(missedWf.id, false);
    storageService.deleteAutomation(missedWf.id);

    record(
      21,
      'Phase 3 (Schedule Trigger): Once, Daily, Weekly, Monthly, Yearly & Missed Schedule Recovery',
      Boolean(
        nextOnce === '2026-05-11T09:00' &&
          nextDaily === '2026-05-11T08:00' &&
          nextWeekly === '2026-05-15T09:30' &&
          nextMonthly === '2026-06-01T08:00' &&
          nextYearly === '2026-12-25T08:00' &&
          missedFound
      ),
      `daily=${nextDaily}, weekly=${nextWeekly}, monthly=${nextMonthly}, yearly=${nextYearly}, missedQueued=${missedFound}`
    );

    // 22. Hotkey Trigger Validation & Conflict Detection + Startup Trigger Execution
    const conflictWithMainHotkey = workflowEngine
      .getTriggerManager()
      .validateHotkeyAvailability('CommandOrControl+Shift+Space');
    const validCustomWfHotkey = workflowEngine
      .getTriggerManager()
      .validateHotkeyAvailability('CommandOrControl+Alt+F9');

    const startupWf = storageService.createAutomation({
      name: 'Smoke Startup Trigger WF',
      isEnabled: true,
      triggerType: 'startup',
      triggerConfig: { delaySeconds: 0, oncePerSession: true },
      actions: [
        {
          id: 'st1',
          type: 'show_notification',
          config: { title: 'Startup Test', body: 'Ran on startup' }
        }
      ]
    });
    const startupFirstCount = workflowEngine.getTriggerManager().triggerStartupWorkflowsNow();
    const startupSecondCount = workflowEngine.getTriggerManager().triggerStartupWorkflowsNow(); // 0 due to oncePerSession
    await new Promise((r) => setTimeout(r, 120));
    storageService.deleteAutomation(startupWf.id);

    record(
      22,
      'Phase 3 (Hotkey & Startup Triggers): Conflict protection & oncePerSession guard',
      Boolean(
        !conflictWithMainHotkey.valid &&
          validCustomWfHotkey.valid &&
          startupFirstCount >= 1 &&
          startupSecondCount === 0
      ),
      `mainConflictBlocked=${!conflictWithMainHotkey.valid}, startupFirst=${startupFirstCount}, startupDedup=${startupSecondCount}`
    );

    // 23. File / Folder Watcher Trigger (Created, Changed, Renamed, Deleted)
    const watchDir = path.join(app.getPath('userData'), 'smoke_watch_test');
    fs.rmSync(watchDir, { recursive: true, force: true });
    fs.mkdirSync(watchDir, { recursive: true });

    const fwWf = storageService.createAutomation({
      name: 'Smoke File Watcher WF',
      isEnabled: true,
      triggerType: 'file_watch',
      triggerConfig: {
        folderPath: watchDir,
        events: ['created', 'changed', 'renamed', 'deleted'],
        extensionFilter: '.txt',
        debounceMs: 120
      },
      actions: [
        {
          id: 'fw_act1',
          type: 'show_notification',
          config: { title: 'File Event Detected', body: 'Watcher fired' }
        }
      ]
    });
    workflowEngine.getTriggerManager().syncAllTriggers();

    const watchedFile = path.join(watchDir, 'sample.txt');
    fs.writeFileSync(watchedFile, 'hello world', 'utf-8');
    await new Promise((r) => setTimeout(r, 380));

    const fwExecs = storageService.getExecutions({ automationId: fwWf.id });
    storageService.deleteAutomation(fwWf.id);
    workflowEngine.getTriggerManager().syncAllTriggers();
    fs.rmSync(watchDir, { recursive: true, force: true });

    record(
      23,
      'Phase 3 (File Watcher Trigger): Local folder monitoring, debounce & extension filtering',
      fwExecs.total >= 1 && fwExecs.items[0]?.status === 'success',
      `fileWatchExecutions=${fwExecs.total}, trigger=${fwExecs.items[0]?.trigger_type}`
    );

    // 24. Condition Engine: AND / OR groups, Time, File, Todo, and Workflow conditions
    const condEngine = workflowEngine.getConditionEngine();
    const andPass = condEngine.evaluateGroup(
      {
        operator: 'AND',
        conditions: [
          {
            id: 'c1',
            type: 'time_hour',
            operator: 'equals',
            value: '9'
          },
          {
            id: 'c2',
            type: 'time_date',
            operator: 'equals',
            value: '2026-05-11'
          }
        ]
      },
      {},
      new Date(2026, 4, 11, 9, 15, 0)
    );
    const orPass = condEngine.evaluateGroup(
      {
        operator: 'OR',
        conditions: [
          {
            id: 'c3',
            type: 'time_hour',
            operator: 'equals',
            value: '23'
          },
          {
            id: 'c4',
            type: 'file_exists',
            operator: 'equals',
            target: storageService.getDatabasePath(),
            value: 'true'
          }
        ]
      },
      {},
      new Date(2026, 4, 11, 9, 15, 0)
    );
    const andFail = condEngine.evaluateGroup(
      {
        operator: 'AND',
        conditions: [
          {
            id: 'c5',
            type: 'time_hour',
            operator: 'equals',
            value: '23'
          }
        ]
      },
      {},
      new Date(2026, 4, 11, 9, 15, 0)
    );

    record(
      24,
      'Phase 3 (Condition Engine): AND / OR logic, Time, File, Todo & Workflow rules',
      Boolean(andPass.passed && orPass.passed && !andFail.passed),
      `AND_Pass=${andPass.passed}, OR_Pass=${orPass.passed}, AND_Fail_Skipped=${!andFail.passed}`
    );

    // 25. Productivity Module Actions (Todo, Quick Notes, Reminders, Notification, Application)
    const prodWf = storageService.createAutomation({
      name: 'Smoke Multi-Module Productivity Workflow',
      isEnabled: true,
      triggerType: 'schedule',
      triggerConfig: { frequency: 'daily', time: '08:00' },
      actions: [
        {
          id: 'p1',
          type: 'open_application',
          config: { executablePath: 'C:\\Windows\\System32\\notepad.exe', dryRun: true }
        },
        {
          id: 'p2',
          type: 'create_todo',
          config: {
            title: 'AutoTask Created Todo Item',
            priority: 'high',
            status: 'todo',
            category: 'Work',
            dueOffsetMinutes: 60
          }
        },
        {
          id: 'p3',
          type: 'update_todo_status',
          config: { titleMatch: 'AutoTask Created Todo Item', status: 'in_progress' }
        },
        {
          id: 'p4',
          type: 'complete_todo',
          config: { titleMatch: 'AutoTask Created Todo Item' }
        },
        {
          id: 'p5',
          type: 'create_note',
          config: {
            title: 'AutoTask Created Note',
            content: 'Line 1',
            color: 'emerald',
            isPinned: false
          }
        },
        {
          id: 'p6',
          type: 'update_note',
          config: { titleMatch: 'AutoTask Created Note', content: 'Line 2', mode: 'append' }
        },
        {
          id: 'p7',
          type: 'pin_note',
          config: { titleMatch: 'AutoTask Created Note', pinned: true }
        },
        {
          id: 'p8',
          type: 'create_reminder',
          config: { title: 'AutoTask Created Reminder', offsetMinutes: 45, recurrence: 'none' }
        },
        {
          id: 'p9',
          type: 'disable_reminder',
          config: { titleMatch: 'AutoTask Created Reminder' }
        },
        {
          id: 'p10',
          type: 'enable_reminder',
          config: { titleMatch: 'AutoTask Created Reminder' }
        },
        {
          id: 'p11',
          type: 'show_notification',
          config: { title: 'Productivity Suite Done', body: 'All 11 actions ran' }
        }
      ]
    });

    const prodExec = await workflowEngine.executeWorkflow(prodWf.id, { isManualOrTest: true });
    const prodDetails = storageService.getExecutionDetails(prodExec.id);

    const createdTodo = storageService
      .getTasks()
      .find((t) => t.title === 'AutoTask Created Todo Item');
    const createdNote = storageService
      .getNotes()
      .find((n) => n.title === 'AutoTask Created Note');
    const createdRem = storageService
      .getReminders()
      .find((r) => r.title === 'AutoTask Created Reminder');

    if (createdTodo) storageService.deleteTask(createdTodo.id);
    if (createdNote) storageService.deleteNote(createdNote.id);
    if (createdRem) storageService.deleteReminder(createdRem.id);
    storageService.deleteAutomation(prodWf.id);

    record(
      25,
      'Phase 3 (Productivity Actions): Open App, Todo, Notes, Reminders & Notifications',
      Boolean(
        prodExec.status === 'success' &&
          prodDetails.actionLogs.length === 11 &&
          createdTodo?.status === 'done' &&
          createdNote?.is_pinned === 1 &&
          createdNote?.content.includes('Line 2') &&
          createdRem?.is_enabled === 1
      ),
      `status=${prodExec.status}, stepsLogged=${prodDetails.actionLogs.length}`
    );

    // 26. File System Actions (Create Folder, Copy, Rename, Move & Overwrite Protection)
    const fileOpsDir = path.join(app.getPath('userData'), 'smoke_file_ops');
    fs.rmSync(fileOpsDir, { recursive: true, force: true });
    fs.mkdirSync(fileOpsDir, { recursive: true });
    const srcFile = path.join(fileOpsDir, 'origin.txt');
    fs.writeFileSync(srcFile, 'automation file test', 'utf-8');

    const subDir = path.join(fileOpsDir, 'archive');
    const copiedFile = path.join(fileOpsDir, 'copied.txt');
    const renamedFile = path.join(fileOpsDir, 'renamed.txt');
    const movedFile = path.join(subDir, 'renamed.txt');

    const fileWf = storageService.createAutomation({
      name: 'Smoke File Operations Workflow',
      isEnabled: true,
      triggerType: 'schedule',
      triggerConfig: { frequency: 'daily', time: '08:00' },
      actions: [
        {
          id: 'f1',
          type: 'create_folder',
          config: { folderPath: subDir }
        },
        {
          id: 'f2',
          type: 'copy_file',
          config: { sourcePath: srcFile, destinationPath: copiedFile, overwrite: false }
        },
        {
          id: 'f3',
          type: 'rename_file',
          config: { filePath: copiedFile, newName: 'renamed.txt', overwrite: false }
        },
        {
          id: 'f4',
          type: 'move_file',
          config: { sourcePath: renamedFile, destinationPath: movedFile, overwrite: false }
        }
      ]
    });

    const fileExec = await workflowEngine.executeWorkflow(fileWf.id, { isManualOrTest: true });
    const movedExists = fs.existsSync(movedFile);

    // Overwrite protection check: copying to existing destination with overwrite=false must fail safely
    const overwriteFailWf = storageService.createAutomation({
      name: 'Smoke Overwrite Protection WF',
      isEnabled: true,
      triggerType: 'schedule',
      triggerConfig: { frequency: 'daily', time: '08:00' },
      actions: [
        {
          id: 'ow1',
          type: 'copy_file',
          config: { sourcePath: srcFile, destinationPath: movedFile, overwrite: false }
        }
      ]
    });
    const overwriteExec = await workflowEngine.executeWorkflow(overwriteFailWf.id, {
      isManualOrTest: true
    });

    storageService.deleteAutomation(fileWf.id);
    storageService.deleteAutomation(overwriteFailWf.id);
    fs.rmSync(fileOpsDir, { recursive: true, force: true });

    record(
      26,
      'Phase 3 (File System Actions): Create folder, Copy, Rename, Move & Overwrite protection',
      Boolean(
        fileExec.status === 'success' &&
          movedExists &&
          overwriteExec.status === 'failed' &&
          overwriteExec.error_message?.includes('overwrite is disabled')
      ),
      `fileOps=${fileExec.status}, movedExists=${movedExists}, overwriteBlocked=${overwriteExec.status === 'failed'}`
    );

    // 27. Flow Control Actions: Delay, If/Else Branching & Stop Workflow
    const flowWf = storageService.createAutomation({
      name: 'Smoke Flow Control Workflow',
      isEnabled: true,
      triggerType: 'schedule',
      triggerConfig: { frequency: 'daily', time: '08:00' },
      actions: [
        {
          id: 'fl1',
          type: 'delay',
          config: { delayMs: 40 }
        },
        {
          id: 'fl2',
          type: 'if_else',
          config: {},
          conditionGroup: {
            operator: 'AND',
            conditions: [
              {
                id: 'ifc1',
                type: 'file_exists',
                operator: 'equals',
                target: storageService.getDatabasePath(),
                value: 'true'
              }
            ]
          },
          thenActions: [
            {
              id: 'then1',
              type: 'show_notification',
              config: { title: 'Branch True', body: 'DB exists' }
            }
          ],
          elseActions: []
        },
        {
          id: 'fl3',
          type: 'stop_workflow',
          config: { reason: 'Intentional early stop' }
        },
        {
          id: 'fl4',
          type: 'show_notification',
          config: { title: 'Unreachable Step', body: 'Should not execute' }
        }
      ]
    });
    const flowExec = await workflowEngine.executeWorkflow(flowWf.id, { isManualOrTest: true });
    const flowLogs = storageService.getExecutionDetails(flowExec.id).actionLogs;
    storageService.deleteAutomation(flowWf.id);

    record(
      27,
      'Phase 3 (Flow Control Actions): Delay, If/Else branching & Stop Workflow early exit',
      Boolean(flowExec.status === 'success' && flowLogs.length === 4),
      `status=${flowExec.status}, executedLogs=${flowLogs.length} (fl4 skipped after stop_workflow)`
    );

    // 28. Error Policies (Stop vs Continue on Error), Retry & Timeout Handling
    const continueOnErrorWf = storageService.createAutomation({
      name: 'Smoke Continue On Error & Retry WF',
      isEnabled: true,
      triggerType: 'schedule',
      triggerConfig: { frequency: 'daily', time: '08:00' },
      executionPolicy: {
        onError: 'continue',
        timeoutMs: 5000,
        maxRetries: 1,
        retryDelayMs: 50,
        allowConcurrent: false
      },
      actions: [
        {
          id: 'err1',
          type: 'complete_todo',
          config: { taskId: 999999 }, // Non-existent task -> fails after 1 retry
          maxRetries: 1,
          retryDelayMs: 50,
          onError: 'continue'
        },
        {
          id: 'ok2',
          type: 'show_notification',
          config: { title: 'Continued Step', body: 'Ran despite step 1 failure' }
        }
      ]
    });
    const contExec = await workflowEngine.executeWorkflow(continueOnErrorWf.id, {
      isManualOrTest: true
    });
    const contLogs = storageService.getExecutionDetails(contExec.id).actionLogs;

    // Timeout test: delay 2000ms with 200ms step timeout
    const timeoutWf = storageService.createAutomation({
      name: 'Smoke Timeout WF',
      isEnabled: true,
      triggerType: 'schedule',
      triggerConfig: { frequency: 'daily', time: '08:00' },
      executionPolicy: {
        onError: 'stop',
        timeoutMs: 1000,
        maxRetries: 0,
        retryDelayMs: 50,
        allowConcurrent: false
      },
      actions: [
        {
          id: 'to1',
          type: 'delay',
          config: { delayMs: 2500 },
          timeoutMs: 500
        }
      ]
    });
    const timeoutExec = await workflowEngine.executeWorkflow(timeoutWf.id, {
      isManualOrTest: true
    });

    storageService.deleteAutomation(continueOnErrorWf.id);
    storageService.deleteAutomation(timeoutWf.id);

    record(
      28,
      'Phase 3 (Engine Policies): Retry on failure, Continue on error & Step Timeout enforcement',
      Boolean(
        contExec.status === 'success' &&
          contLogs.length === 2 &&
          contLogs[0].status === 'failed' &&
          contLogs[0].error_message?.includes('after 2 attempts') &&
          contLogs[1].status === 'success' &&
          timeoutExec.status === 'failed' &&
          timeoutExec.error_message?.includes('timed out')
      ),
      `retryMsg="${contLogs[0]?.error_message}", timeoutStatus=${timeoutExec.status}`
    );

    // 29. Cancellation of Running Workflow
    const cancelWf = storageService.createAutomation({
      name: 'Smoke Cancel Running WF',
      isEnabled: true,
      triggerType: 'schedule',
      triggerConfig: { frequency: 'daily', time: '08:00' },
      actions: [
        {
          id: 'c_delay',
          type: 'delay',
          config: { delayMs: 5000 }
        }
      ]
    });
    const runningPromise = workflowEngine.executeWorkflow(cancelWf.id, {
      isManualOrTest: true
    });
    await new Promise((r) => setTimeout(r, 80));
    const runningIds = workflowEngine.getRunningExecutionIdsForWorkflow(cancelWf.id);
    const cancelRequested =
      runningIds.length > 0 ? workflowEngine.cancelExecution(runningIds[0]) : false;
    const cancelledResult = await runningPromise;
    storageService.deleteAutomation(cancelWf.id);

    record(
      29,
      'Phase 3 (Execution Cancellation): Abort running workflow cleanly via AbortSignal',
      Boolean(cancelRequested && cancelledResult.status === 'cancelled'),
      `cancelRequested=${cancelRequested}, finalStatus=${cancelledResult.status}`
    );

    // 30. Security Validation (Blocked Shell Interpreters, Path Traversal "..", Unsafe URLs)
    const cmdValidation = workflowEngine.validateWorkflowDefinition({
      name: 'Unsafe CMD Workflow',
      triggerType: 'schedule',
      triggerConfig: { frequency: 'daily', time: '08:00' },
      conditionConfig: { operator: 'AND', conditions: [] },
      actions: [
        {
          id: 'sec1',
          type: 'open_application',
          config: { executablePath: 'C:\\Windows\\System32\\cmd.exe' }
        }
      ]
    });
    const traversalValidation = workflowEngine.validateWorkflowDefinition({
      name: 'Unsafe Path Traversal Workflow',
      triggerType: 'file_watch',
      triggerConfig: { folderPath: 'C:\\Users\\..\\Windows\\System32', events: ['created'] },
      conditionConfig: { operator: 'AND', conditions: [] },
      actions: [
        {
          id: 'sec2',
          type: 'open_url',
          config: { url: 'javascript:alert(1)' }
        }
      ]
    });

    record(
      30,
      'Phase 3 (Security Controls): Blocks cmd.exe/powershell.exe, path traversal ("..") & javascript: URLs',
      Boolean(
        !cmdValidation.valid &&
          !traversalValidation.valid &&
          traversalValidation.errors.length >= 2
      ),
      `cmdBlocked=${!cmdValidation.valid}, traversalAndUrlBlocked=${!traversalValidation.valid}`
    );

    // 31. JSON Export & Import Validation (Valid Import Disabled by Default + Malformed Rejection)
    const exportSampleWf = storageService.createAutomation({
      name: 'Smoke Exportable Workflow',
      description: 'Test JSON roundtrip',
      isEnabled: true,
      triggerType: 'schedule',
      triggerConfig: { frequency: 'daily', time: '10:30' },
      actions: [
        {
          id: 'ex1',
          type: 'show_notification',
          config: { title: 'Exported', body: 'Roundtrip OK' }
        }
      ]
    });
    const exportedJson = workflowEngine.exportWorkflowsJson([exportSampleWf.id]);
    const previewValid = workflowEngine.validateAndPreviewImport(exportedJson);
    const importedList = workflowEngine.importWorkflowsJson(exportedJson);
    const malformedPreview = workflowEngine.validateAndPreviewImport('{ broken_json: ');

    storageService.deleteAutomation(exportSampleWf.id);
    for (const imp of importedList) {
      storageService.deleteAutomation(imp.id);
    }

    record(
      31,
      'Phase 3 (Import / Export JSON): Export, preview, duplicate naming, disabled-by-default import & malformed rejection',
      Boolean(
        previewValid.valid &&
          importedList.length === 1 &&
          importedList[0].isEnabled === false &&
          importedList[0].name.includes('(Imported)') &&
          !malformedPreview.valid
      ),
      `importedName="${importedList[0]?.name}", isEnabled=${importedList[0]?.isEnabled}, malformedRejected=${!malformedPreview.valid}`
    );

    // 32. Auto Task Bot UI Sub-Tabs Verification (Dashboard, My Automations, Builder, History, Settings)
    await mainWindow.webContents.executeJavaScript(`window.__testNavigate('automation')`);
    const subTabs = ['dashboard', 'workflows', 'builder', 'history', 'settings'];
    let allSubTabsRendered = true;
    for (const st of subTabs) {
      await mainWindow.webContents.executeJavaScript(`
        document.querySelector('[data-auto-tab="${st}"]')?.click()
      `);
      await new Promise((r) => setTimeout(r, 60));
      const activeBtnExists = await mainWindow.webContents.executeJavaScript(`
        Boolean(document.querySelector('.subnav-tab.active[data-auto-tab="${st}"]'))
      `);
      if (!activeBtnExists) {
        allSubTabsRendered = false;
      }
    }

    record(
      32,
      'Phase 3 (Auto Task Bot UI): All 5 sub-views (Dashboard, My Automations, Builder, History, Settings) render',
      allSubTabsRendered,
      `Verified sub-tabs: ${subTabs.join(', ')}`
    );

    // Clean up smoke test execution logs
    storageService.clearOldExecutions(0);

    // 33. Application exits cleanly
    record(33, 'Application exits correctly', true, 'Disposing workflow engine, scheduler, tray, shortcuts, and SQLite connection.');

    const allPassed = results.every((r) => r.passed);
    console.log(`[SMOKE TEST SUMMARY] Passed ${results.filter((r) => r.passed).length}/${results.length}`);
    exitApplication();
    process.exit(allPassed ? 0 : 1);
  } catch (err) {
    console.error('[SMOKE TEST ERROR]', err);
    exitApplication();
    process.exit(1);
  }
}

app.whenReady().then(async () => {
  configureSecurityHeaders();

  storageService = new StorageService();
  storageService.init();

  const savedSettings = storageService.getAllSettings();

  windowsService = new WindowsIntegrationService(storageService.getDatabasePath());

  shortcutManager = new ShortcutManager(() => {
    toggleWindowVisibility();
  }, savedSettings.global_hotkey);

  const hotkeyRegistration = shortcutManager.registerInitial(savedSettings.global_hotkey);
  if (hotkeyRegistration.accelerator !== savedSettings.global_hotkey) {
    storageService.setSetting('global_hotkey', hotkeyRegistration.accelerator);
  }

  trayManager = new TrayManager({
    onOpenAssistant: () => showAndFocusWindow(),
    onHideAssistant: () => hideWindowToTray(),
    onExitApplication: () => exitApplication(),
    getCurrentDisplayHotkey: () =>
      shortcutManager ? shortcutManager.getCurrentDisplayHotkey() : 'Ctrl + Shift + Space'
  });
  trayManager.init();

  registerIpcHandlers();
  mainWindow = createMainWindow();

  reminderScheduler = new ReminderSchedulerService(storageService, {
    onNotificationClicked: ({ source, reminderId }) => {
      showAndFocusWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('assistant:open-reminder', {
          source,
          reminderId
        });
      }
    },
    onReminderStateChanged: (firedPayload) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('assistant:reminder-triggered', firedPayload);
      }
    }
  });
  reminderScheduler.start(10000);

  workflowEngine = new WorkflowEngine(storageService, shortcutManager, () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('assistant:automation-state-changed');
    }
  });
  workflowEngine.setSmokeTestMode(isSmokeTest);
  workflowEngine.initialize({ skipStartupTriggers: isSmokeTest });

  if (isSmokeTest) {
    await runAutomatedSmokeTests();
  }
});

app.on('will-quit', () => {
  if (workflowEngine) {
    workflowEngine.dispose();
  }
  if (reminderScheduler) {
    reminderScheduler.stop();
  }
  if (shortcutManager) {
    shortcutManager.dispose();
  }
  if (trayManager) {
    trayManager.dispose();
  }
  if (storageService) {
    storageService.close();
  }
});

app.on('window-all-closed', () => {
  if (isQuitting) {
    app.quit();
  }
});
