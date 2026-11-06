import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { Notification, shell } from 'electron';
import {
  StorageService,
  TaskPriority,
  TaskStatus,
  RecurrenceType,
  NoteColor
} from '../../storage';
import { SecurityValidator } from '../security/path-validator';
import { ConditionEngine } from '../conditions/condition-engine';
import { ActionType, WorkflowActionStep } from '../types';

export interface ActionExecutionContext {
  automationId: number;
  workflowName: string;
  executionId: number;
  triggerType: string;
  triggerPayload: Record<string, unknown>;
  abortSignal: AbortSignal;
  isSmokeTest?: boolean;
  depth?: number;
  executeNestedActions?: (
    steps: WorkflowActionStep[],
    nestedDepth: number
  ) => Promise<{ stopped: boolean; summary: string }>;
}

export interface ActionExecutionOutput {
  inputSummary: string;
  outputSummary: string;
  stopWorkflowRequested?: boolean;
}

export class ActionRegistry {
  private storage: StorageService;
  private conditionEngine: ConditionEngine;
  private onMainWindowFocusReminder?: (reminderId: number) => void;

  constructor(
    storage: StorageService,
    conditionEngine: ConditionEngine,
    onMainWindowFocusReminder?: (reminderId: number) => void
  ) {
    this.storage = storage;
    this.conditionEngine = conditionEngine;
    this.onMainWindowFocusReminder = onMainWindowFocusReminder;
  }

  /**
   * Validate an action step's schema and parameters before saving or running.
   */
  public validateActionStep(step: WorkflowActionStep): { valid: boolean; error?: string } {
    if (!step || !step.type) {
      return { valid: false, error: 'Action type is missing.' };
    }
    const cfg = step.config || {};

    switch (step.type) {
      case 'open_application': {
        const exePath = String(cfg.executablePath || '').trim();
        if (!exePath) {
          return { valid: false, error: 'Open Application requires an executablePath.' };
        }
        const settings = this.storage.getAutomationSettings();
        const check = SecurityValidator.validateTrustedExecutable(
          exePath,
          settings.trusted_app_paths
        );
        if (!check.valid) return { valid: false, error: check.error };
        return { valid: true };
      }

      case 'open_folder':
      case 'create_folder': {
        const folderPath = String(cfg.folderPath || '').trim();
        const check = SecurityValidator.validateLocalPath(folderPath, {
          allowSystemReadOnly: step.type === 'open_folder'
        });
        if (!check.valid) return { valid: false, error: check.error };
        return { valid: true };
      }

      case 'open_url': {
        const url = String(cfg.url || '').trim();
        const check = SecurityValidator.validateSafeUrl(url);
        if (!check.valid) return { valid: false, error: check.error };
        return { valid: true };
      }

      case 'show_notification': {
        if (!String(cfg.title || '').trim()) {
          return { valid: false, error: 'Notification action requires a title.' };
        }
        return { valid: true };
      }

      case 'create_todo': {
        if (!String(cfg.title || '').trim()) {
          return { valid: false, error: 'Create Todo action requires a task title.' };
        }
        return { valid: true };
      }

      case 'update_todo_status':
      case 'complete_todo': {
        if (!cfg.taskId && !String(cfg.titleMatch || '').trim()) {
          return {
            valid: false,
            error: `${step.type} requires either a taskId or titleMatch.`
          };
        }
        return { valid: true };
      }

      case 'create_note': {
        if (!String(cfg.title || '').trim()) {
          return { valid: false, error: 'Create Note action requires a title.' };
        }
        return { valid: true };
      }

      case 'update_note':
      case 'pin_note': {
        if (!cfg.noteId && !String(cfg.titleMatch || '').trim()) {
          return {
            valid: false,
            error: `${step.type} requires either a noteId or titleMatch.`
          };
        }
        return { valid: true };
      }

      case 'create_reminder': {
        if (!String(cfg.title || '').trim()) {
          return { valid: false, error: 'Create Reminder action requires a title.' };
        }
        return { valid: true };
      }

      case 'enable_reminder':
      case 'disable_reminder': {
        if (!cfg.reminderId && !String(cfg.titleMatch || '').trim()) {
          return {
            valid: false,
            error: `${step.type} requires either a reminderId or titleMatch.`
          };
        }
        return { valid: true };
      }

      case 'copy_file':
      case 'move_file': {
        const srcCheck = SecurityValidator.validateLocalPath(cfg.sourcePath, {
          allowSystemReadOnly: step.type === 'copy_file'
        });
        if (!srcCheck.valid) {
          return { valid: false, error: `Invalid sourcePath: ${srcCheck.error}` };
        }
        const destCheck = SecurityValidator.validateLocalPath(cfg.destinationPath);
        if (!destCheck.valid) {
          return { valid: false, error: `Invalid destinationPath: ${destCheck.error}` };
        }
        return { valid: true };
      }

      case 'rename_file': {
        const srcCheck = SecurityValidator.validateLocalPath(cfg.filePath);
        if (!srcCheck.valid) {
          return { valid: false, error: `Invalid filePath: ${srcCheck.error}` };
        }
        const newName = String(cfg.newName || '').trim();
        if (!newName || newName.includes('/') || newName.includes('\\') || newName === '..') {
          return {
            valid: false,
            error: 'newName must be a valid file name without path separators.'
          };
        }
        return { valid: true };
      }

      case 'delay': {
        const ms = Number(cfg.delayMs ?? (Number(cfg.seconds || 0) * 1000));
        if (Number.isNaN(ms) || ms < 0 || ms > 3_600_000) {
          return {
            valid: false,
            error: 'Delay must be between 0 ms and 3,600,000 ms (1 hour).'
          };
        }
        return { valid: true };
      }

      case 'stop_workflow':
      case 'if_else':
        return { valid: true };

      default:
        return { valid: false, error: `Unknown action type: ${String(step.type)}` };
    }
  }

  public async executeAction(
    step: WorkflowActionStep,
    context: ActionExecutionContext
  ): Promise<ActionExecutionOutput> {
    if (context.abortSignal.aborted) {
      throw new Error('Execution cancelled');
    }

    const cfg = step.config || {};
    const type: ActionType = step.type;

    switch (type) {
      case 'open_application': {
        const exePath = String(cfg.executablePath || '').trim();
        const rawArgs = Array.isArray(cfg.args)
          ? cfg.args.map((a) => String(a))
          : typeof cfg.args === 'string' && cfg.args.trim()
          ? cfg.args
              .trim()
              .split(/\s+/)
          : [];

        const settings = this.storage.getAutomationSettings();
        const validation = SecurityValidator.validateTrustedExecutable(
          exePath,
          settings.trusted_app_paths
        );
        if (!validation.valid || !validation.resolvedPath) {
          throw new Error(validation.error || 'Untrusted executable path.');
        }

        if (!fs.existsSync(validation.resolvedPath)) {
          throw new Error(`Executable not found on disk: ${validation.resolvedPath}`);
        }

        if (!context.isSmokeTest && cfg.dryRun !== true) {
          const child = spawn(validation.resolvedPath, rawArgs, {
            detached: true,
            shell: false,
            stdio: 'ignore',
            windowsHide: false
          });
          child.unref();
        }

        return {
          inputSummary: JSON.stringify({ executablePath: validation.resolvedPath, args: rawArgs }),
          outputSummary: `Launched trusted application: ${path.basename(validation.resolvedPath)}`
        };
      }

      case 'open_folder': {
        const validation = SecurityValidator.validateLocalPath(cfg.folderPath, {
          allowSystemReadOnly: true
        });
        if (!validation.valid || !validation.resolvedPath) {
          throw new Error(validation.error || 'Invalid folder path.');
        }
        if (!fs.existsSync(validation.resolvedPath)) {
          throw new Error(`Folder does not exist: ${validation.resolvedPath}`);
        }
        const stat = fs.statSync(validation.resolvedPath);
        if (!stat.isDirectory()) {
          throw new Error(`Path is not a directory: ${validation.resolvedPath}`);
        }
        if (!context.isSmokeTest && cfg.dryRun !== true) {
          const errStr = await shell.openPath(validation.resolvedPath);
          if (errStr) {
            throw new Error(`Windows failed to open folder: ${errStr}`);
          }
        }
        return {
          inputSummary: JSON.stringify({ folderPath: validation.resolvedPath }),
          outputSummary: `Opened folder in Explorer: ${validation.resolvedPath}`
        };
      }

      case 'open_url': {
        const validation = SecurityValidator.validateSafeUrl(cfg.url);
        if (!validation.valid || !validation.normalizedUrl) {
          throw new Error(validation.error || 'Invalid URL.');
        }
        if (!context.isSmokeTest && cfg.dryRun !== true) {
          await shell.openExternal(validation.normalizedUrl);
        }
        return {
          inputSummary: JSON.stringify({ url: validation.normalizedUrl }),
          outputSummary: `Opened URL in default browser: ${validation.normalizedUrl}`
        };
      }

      case 'show_notification': {
        const title = String(cfg.title || context.workflowName || 'Auto Task Bot').trim();
        const body = String(cfg.body || cfg.message || 'Workflow notification').trim();
        const settings = this.storage.getAutomationSettings();

        if (settings.notifications_enabled && Notification.isSupported() && !context.isSmokeTest) {
          const notif = new Notification({
            title,
            body,
            silent: Boolean(cfg.silent)
          });
          notif.show();
        }

        return {
          inputSummary: JSON.stringify({ title, body }),
          outputSummary: `Notification displayed: "${title}"`
        };
      }

      case 'create_todo': {
        const title = String(cfg.title || '').trim();
        if (!title) throw new Error('Todo title cannot be empty.');
        const description = String(cfg.description || '').trim();
        const status = (['todo', 'in_progress', 'done'].includes(String(cfg.status))
          ? cfg.status
          : 'todo') as TaskStatus;
        const priority = (['low', 'medium', 'high'].includes(String(cfg.priority))
          ? cfg.priority
          : 'medium') as TaskPriority;

        let categoryId = 1;
        if (cfg.categoryId !== undefined && Number(cfg.categoryId) > 0) {
          categoryId = Number(cfg.categoryId);
        } else if (cfg.category && String(cfg.category).trim()) {
          const catName = String(cfg.category).trim();
          const cats = this.storage.getTaskCategories();
          const existingCat = cats.find(
            (c) => c.name.toLowerCase() === catName.toLowerCase()
          );
          if (existingCat) {
            categoryId = existingCat.id;
          } else {
            const createdCat = this.storage.createTaskCategory(catName, '#3b82f6');
            categoryId = createdCat.id;
          }
        }

        let dueAt: string | null = null;
        if (cfg.dueAt && typeof cfg.dueAt === 'string' && cfg.dueAt.trim()) {
          dueAt = cfg.dueAt.trim();
        } else if (cfg.dueOffsetMinutes !== undefined && cfg.dueOffsetMinutes !== '') {
          const offsetMs = Number(cfg.dueOffsetMinutes) * 60_000;
          if (!Number.isNaN(offsetMs)) {
            dueAt = this.toLocalIsoMinute(new Date(Date.now() + offsetMs));
          }
        }

        const created = this.storage.createTask({
          title,
          description,
          status,
          priority,
          category_id: categoryId,
          due_at: dueAt
        });

        return {
          inputSummary: JSON.stringify({ title, priority, categoryId, dueAt }),
          outputSummary: `Created Todo task #${created.id}: "${created.title}"`
        };
      }

      case 'update_todo_status':
      case 'complete_todo': {
        const targetStatus: TaskStatus =
          type === 'complete_todo'
            ? 'done'
            : (['todo', 'in_progress', 'done'].includes(String(cfg.status))
                ? (cfg.status as TaskStatus)
                : 'done');

        const task = this.resolveTask(cfg.taskId, cfg.titleMatch);
        if (!task) {
          throw new Error(
            `Target Todo task not found (taskId=${cfg.taskId || ''}, titleMatch=${cfg.titleMatch || ''}).`
          );
        }

        const updated = this.storage.updateTask(task.id, { status: targetStatus });
        return {
          inputSummary: JSON.stringify({ taskId: task.id, status: targetStatus }),
          outputSummary: `Updated Todo task #${task.id} ("${updated.title}") status to "${targetStatus}"`
        };
      }

      case 'create_note': {
        const title = String(cfg.title || '').trim();
        if (!title) throw new Error('Note title cannot be empty.');
        const content = String(cfg.content || '');
        const validColors = ['slate', 'blue', 'emerald', 'amber', 'rose', 'violet'];
        const color = (
          validColors.includes(String(cfg.color)) ? cfg.color : 'slate'
        ) as NoteColor;
        const isPinned = Boolean(cfg.isPinned);

        const note = this.storage.createNote({
          title,
          content,
          color,
          is_pinned: isPinned
        });

        return {
          inputSummary: JSON.stringify({ title, color, isPinned }),
          outputSummary: `Created Quick Note #${note.id}: "${note.title}"`
        };
      }

      case 'update_note': {
        const note = this.resolveNote(cfg.noteId, cfg.titleMatch);
        if (!note) {
          throw new Error(
            `Target Quick Note not found (noteId=${cfg.noteId || ''}, titleMatch=${cfg.titleMatch || ''}).`
          );
        }

        const mode = String(cfg.mode || 'append'); // 'append' | 'replace'
        const newText = String(cfg.content || '');
        const nextContent =
          mode === 'replace'
            ? newText
            : note.content
            ? `${note.content}\n${newText}`
            : newText;

        const nextTitle = cfg.newTitle ? String(cfg.newTitle).trim() : note.title;
        const validColors = ['slate', 'blue', 'emerald', 'amber', 'rose', 'violet'];
        const nextColor = (
          cfg.color && validColors.includes(String(cfg.color))
            ? cfg.color
            : note.color
        ) as NoteColor;

        const updated = this.storage.updateNote(note.id, {
          title: nextTitle,
          content: nextContent,
          color: nextColor,
          is_pinned: cfg.isPinned !== undefined ? Boolean(cfg.isPinned) : note.is_pinned === 1
        });

        return {
          inputSummary: JSON.stringify({ noteId: note.id, mode }),
          outputSummary: `Updated Quick Note #${note.id} ("${updated.title}")`
        };
      }

      case 'pin_note': {
        const note = this.resolveNote(cfg.noteId, cfg.titleMatch);
        if (!note) {
          throw new Error(
            `Target Quick Note not found (noteId=${cfg.noteId || ''}, titleMatch=${cfg.titleMatch || ''}).`
          );
        }
        const pinned = cfg.pinned !== undefined ? Boolean(cfg.pinned) : true;
        this.storage.updateNote(note.id, { is_pinned: pinned });
        return {
          inputSummary: JSON.stringify({ noteId: note.id, pinned }),
          outputSummary: `${pinned ? 'Pinned' : 'Unpinned'} Quick Note #${note.id} ("${note.title}")`
        };
      }

      case 'create_reminder': {
        const title = String(cfg.title || '').trim();
        if (!title) throw new Error('Reminder title cannot be empty.');
        const description = String(cfg.description || '').trim();
        const recurrence = (['none', 'daily', 'weekly', 'monthly', 'yearly'].includes(
          String(cfg.recurrence)
        )
          ? cfg.recurrence
          : 'none') as RecurrenceType;

        let remindAt = String(cfg.remindAt || cfg.triggerAt || '').trim();
        if (!remindAt) {
          const offsetMins = Number(cfg.offsetMinutes ?? 30);
          const d = new Date(Date.now() + (Number.isNaN(offsetMins) ? 30 : offsetMins) * 60_000);
          remindAt = this.toLocalIsoMinute(d);
        }

        const created = this.storage.createReminder({
          title,
          description,
          trigger_at: remindAt,
          recurrence_type: recurrence,
          is_enabled: cfg.isEnabled !== undefined ? Boolean(cfg.isEnabled) : true
        });

        return {
          inputSummary: JSON.stringify({ title, remindAt, recurrence }),
          outputSummary: `Created Reminder #${created.id}: "${created.title}" at ${created.trigger_at}`
        };
      }

      case 'enable_reminder':
      case 'disable_reminder': {
        const reminder = this.resolveReminder(cfg.reminderId, cfg.titleMatch);
        if (!reminder) {
          throw new Error(
            `Target Reminder not found (reminderId=${cfg.reminderId || ''}, titleMatch=${
              cfg.titleMatch || ''
            }).`
          );
        }
        const enabled = type === 'enable_reminder';
        this.storage.updateReminder(reminder.id, { is_enabled: enabled });
        if (enabled && this.onMainWindowFocusReminder) {
          // Optional hook
        }
        return {
          inputSummary: JSON.stringify({ reminderId: reminder.id, enabled }),
          outputSummary: `${enabled ? 'Enabled' : 'Disabled'} Reminder #${reminder.id} ("${
            reminder.title
          }")`
        };
      }

      case 'copy_file': {
        const srcVal = SecurityValidator.validateLocalPath(cfg.sourcePath, {
          allowSystemReadOnly: true
        });
        if (!srcVal.valid || !srcVal.resolvedPath) {
          throw new Error(`Invalid sourcePath: ${srcVal.error}`);
        }
        const destVal = SecurityValidator.validateLocalPath(cfg.destinationPath);
        if (!destVal.valid || !destVal.resolvedPath) {
          throw new Error(`Invalid destinationPath: ${destVal.error}`);
        }

        if (!fs.existsSync(srcVal.resolvedPath)) {
          throw new Error(`Source file does not exist: ${srcVal.resolvedPath}`);
        }
        const srcStat = fs.statSync(srcVal.resolvedPath);
        if (!srcStat.isFile()) {
          throw new Error(`Source path is not a regular file: ${srcVal.resolvedPath}`);
        }

        let finalDest = destVal.resolvedPath;
        if (fs.existsSync(finalDest) && fs.statSync(finalDest).isDirectory()) {
          finalDest = path.join(finalDest, path.basename(srcVal.resolvedPath));
        }

        const overwrite = Boolean(cfg.overwrite);
        if (fs.existsSync(finalDest) && !overwrite) {
          throw new Error(
            `Destination file already exists and overwrite is disabled: ${finalDest}`
          );
        }

        fs.mkdirSync(path.dirname(finalDest), { recursive: true });
        fs.copyFileSync(srcVal.resolvedPath, finalDest);

        return {
          inputSummary: JSON.stringify({
            sourcePath: srcVal.resolvedPath,
            destinationPath: finalDest,
            overwrite
          }),
          outputSummary: `Copied file to ${finalDest}`
        };
      }

      case 'move_file': {
        const srcVal = SecurityValidator.validateLocalPath(cfg.sourcePath);
        if (!srcVal.valid || !srcVal.resolvedPath) {
          throw new Error(`Invalid sourcePath: ${srcVal.error}`);
        }
        const destVal = SecurityValidator.validateLocalPath(cfg.destinationPath);
        if (!destVal.valid || !destVal.resolvedPath) {
          throw new Error(`Invalid destinationPath: ${destVal.error}`);
        }

        if (!fs.existsSync(srcVal.resolvedPath)) {
          throw new Error(`Source file does not exist: ${srcVal.resolvedPath}`);
        }
        const srcStat = fs.statSync(srcVal.resolvedPath);
        if (!srcStat.isFile()) {
          throw new Error(`Source path is not a regular file: ${srcVal.resolvedPath}`);
        }

        let finalDest = destVal.resolvedPath;
        if (fs.existsSync(finalDest) && fs.statSync(finalDest).isDirectory()) {
          finalDest = path.join(finalDest, path.basename(srcVal.resolvedPath));
        }

        const overwrite = Boolean(cfg.overwrite);
        if (fs.existsSync(finalDest) && !overwrite) {
          throw new Error(
            `Destination file already exists and overwrite is disabled: ${finalDest}`
          );
        }

        fs.mkdirSync(path.dirname(finalDest), { recursive: true });
        try {
          fs.renameSync(srcVal.resolvedPath, finalDest);
        } catch {
          // Cross-volume fallback
          fs.copyFileSync(srcVal.resolvedPath, finalDest);
          fs.unlinkSync(srcVal.resolvedPath);
        }

        return {
          inputSummary: JSON.stringify({
            sourcePath: srcVal.resolvedPath,
            destinationPath: finalDest,
            overwrite
          }),
          outputSummary: `Moved file to ${finalDest}`
        };
      }

      case 'rename_file': {
        const fileVal = SecurityValidator.validateLocalPath(cfg.filePath);
        if (!fileVal.valid || !fileVal.resolvedPath) {
          throw new Error(`Invalid filePath: ${fileVal.error}`);
        }
        const newName = String(cfg.newName || '').trim();
        if (!newName || newName.includes('/') || newName.includes('\\') || newName === '..') {
          throw new Error('newName must be a valid filename without path separators.');
        }

        if (!fs.existsSync(fileVal.resolvedPath)) {
          throw new Error(`File does not exist: ${fileVal.resolvedPath}`);
        }

        const targetPath = path.join(path.dirname(fileVal.resolvedPath), newName);
        const overwrite = Boolean(cfg.overwrite);
        if (fs.existsSync(targetPath) && !overwrite) {
          throw new Error(
            `Target file "${targetPath}" already exists and overwrite is disabled.`
          );
        }

        fs.renameSync(fileVal.resolvedPath, targetPath);
        return {
          inputSummary: JSON.stringify({ filePath: fileVal.resolvedPath, newName }),
          outputSummary: `Renamed file to ${targetPath}`
        };
      }

      case 'create_folder': {
        const folderVal = SecurityValidator.validateLocalPath(cfg.folderPath);
        if (!folderVal.valid || !folderVal.resolvedPath) {
          throw new Error(`Invalid folderPath: ${folderVal.error}`);
        }
        fs.mkdirSync(folderVal.resolvedPath, { recursive: true });
        return {
          inputSummary: JSON.stringify({ folderPath: folderVal.resolvedPath }),
          outputSummary: `Created folder: ${folderVal.resolvedPath}`
        };
      }

      case 'delay': {
        const delayMs = Math.max(
          0,
          Number(cfg.delayMs ?? (Number(cfg.seconds || 0) * 1000)) || 0
        );
        await this.sleepWithAbort(delayMs, context.abortSignal);
        return {
          inputSummary: JSON.stringify({ delayMs }),
          outputSummary: `Delayed execution for ${delayMs} ms`
        };
      }

      case 'stop_workflow': {
        const reason = String(cfg.reason || 'Stopped by Stop Workflow action').trim();
        return {
          inputSummary: JSON.stringify({ reason }),
          outputSummary: `Workflow stopped intentionally: ${reason}`,
          stopWorkflowRequested: true
        };
      }

      case 'if_else': {
        const currentDepth = context.depth ?? 0;
        if (currentDepth >= 5) {
          throw new Error('Maximum nested If/Else depth (5) exceeded.');
        }

        const evalResult = this.conditionEngine.evaluateGroup(
          step.conditionGroup,
          context.triggerPayload
        );
        const branchToRun = evalResult.passed
          ? step.thenActions || []
          : step.elseActions || [];
        const branchLabel = evalResult.passed ? 'THEN' : 'ELSE';

        let nestedResult = { stopped: false, summary: 'No nested actions in branch' };
        if (branchToRun.length > 0 && context.executeNestedActions) {
          nestedResult = await context.executeNestedActions(branchToRun, currentDepth + 1);
        }

        return {
          inputSummary: JSON.stringify({
            conditionSummary: evalResult.summary,
            branchChosen: branchLabel,
            branchSteps: branchToRun.length
          }),
          outputSummary: `If/Else evaluated ${evalResult.passed ? 'TRUE' : 'FALSE'} -> ran ${branchLabel} branch (${branchToRun.length} steps). ${nestedResult.summary}`,
          stopWorkflowRequested: nestedResult.stopped
        };
      }

      default:
        throw new Error(`Unsupported action type: ${String(type)}`);
    }
  }

  private resolveTask(taskIdRaw: unknown, titleMatchRaw: unknown) {
    const tasks = this.storage.getTasks();
    if (taskIdRaw !== undefined && taskIdRaw !== null && String(taskIdRaw).trim() !== '') {
      const idNum = Number(taskIdRaw);
      const found = tasks.find((t) => t.id === idNum);
      if (found) return found;
    }
    const query = String(titleMatchRaw || '').trim().toLowerCase();
    if (query) {
      return tasks.find((t) => t.title.toLowerCase().includes(query)) || null;
    }
    return null;
  }

  private resolveNote(noteIdRaw: unknown, titleMatchRaw: unknown) {
    const notes = this.storage.getNotes();
    if (noteIdRaw !== undefined && noteIdRaw !== null && String(noteIdRaw).trim() !== '') {
      const idNum = Number(noteIdRaw);
      const found = notes.find((n) => n.id === idNum);
      if (found) return found;
    }
    const query = String(titleMatchRaw || '').trim().toLowerCase();
    if (query) {
      return notes.find((n) => n.title.toLowerCase().includes(query)) || null;
    }
    return null;
  }

  private resolveReminder(reminderIdRaw: unknown, titleMatchRaw: unknown) {
    const reminders = this.storage.getReminders();
    if (
      reminderIdRaw !== undefined &&
      reminderIdRaw !== null &&
      String(reminderIdRaw).trim() !== ''
    ) {
      const idNum = Number(reminderIdRaw);
      const found = reminders.find((r) => r.id === idNum);
      if (found) return found;
    }
    const query = String(titleMatchRaw || '').trim().toLowerCase();
    if (query) {
      return reminders.find((r) => r.title.toLowerCase().includes(query)) || null;
    }
    return null;
  }

  private sleepWithAbort(ms: number, signal: AbortSignal): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject(new Error('Execution cancelled during delay'));
        return;
      }
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);

      const onAbort = () => {
        clearTimeout(timer);
        reject(new Error('Execution cancelled during delay'));
      };

      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  private toLocalIsoMinute(d: Date): string {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
  }
}
