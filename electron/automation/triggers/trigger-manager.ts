import * as fs from 'fs';
import * as path from 'path';
import { globalShortcut } from 'electron';
import { StorageService } from '../../storage';
import { ShortcutManager } from '../../shortcut';
import { SecurityValidator } from '../security/path-validator';
import {
  AutomationWorkflow,
  FileWatchEventType,
  FileWatchTriggerConfig,
  HotkeyTriggerConfig,
  MissedSchedulePolicy,
  PendingMissedApproval,
  ScheduleTriggerConfig,
  StartupTriggerConfig
} from '../types';

export type TriggerFireCallback = (
  workflow: AutomationWorkflow,
  triggerSource: string,
  payload: Record<string, unknown>
) => void;

interface FileSnapshotEntry {
  mtimeMs: number;
  size: number;
}

interface ActiveFileWatcher {
  automationId: number;
  folderPath: string;
  watcher: fs.FSWatcher;
  debounceTimer: NodeJS.Timeout | null;
  snapshot: Map<string, FileSnapshotEntry>;
}

export class TriggerManager {
  private storage: StorageService;
  private shortcutManager: ShortcutManager;
  private onTriggerFire: TriggerFireCallback;

  private scheduleInterval: NodeJS.Timeout | null = null;
  private registeredHotkeys: Map<number, string> = new Map(); // automationId -> accelerator
  private activeFileWatchers: Map<number, ActiveFileWatcher> = new Map();
  private startupTimers: Map<number, NodeJS.Timeout> = new Map();
  private startupExecutedThisSession: Set<number> = new Set();
  private pendingMissedApprovals: Map<number, PendingMissedApproval> = new Map();
  private lastFiredMinuteKey: Map<number, string> = new Map();

  constructor(
    storage: StorageService,
    shortcutManager: ShortcutManager,
    onTriggerFire: TriggerFireCallback
  ) {
    this.storage = storage;
    this.shortcutManager = shortcutManager;
    this.onTriggerFire = onTriggerFire;
  }

  /**
   * Initialize all triggers on application startup:
   * 1. Check missed schedules and compute next_execution_at
   * 2. Start schedule ticker
   * 3. Sync hotkeys and file watchers
   * 4. Fire startup triggers
   */
  public initialize(options: { skipStartupTriggers?: boolean } = {}): void {
    this.recoverAndSyncSchedules(new Date());
    this.syncAllTriggers();

    if (this.scheduleInterval) {
      clearInterval(this.scheduleInterval);
    }
    this.scheduleInterval = setInterval(() => {
      this.tickSchedules(new Date());
    }, 10_000);

    if (!options.skipStartupTriggers) {
      this.scheduleStartupWorkflows();
    }
  }

  public dispose(): void {
    if (this.scheduleInterval) {
      clearInterval(this.scheduleInterval);
      this.scheduleInterval = null;
    }

    for (const timer of this.startupTimers.values()) {
      clearTimeout(timer);
    }
    this.startupTimers.clear();

    this.unregisterAllWorkflowHotkeys();
    this.closeAllFileWatchers();
  }

  public getPendingMissedApprovals(): PendingMissedApproval[] {
    return Array.from(this.pendingMissedApprovals.values());
  }

  public resolveMissedApproval(automationId: number, approveRun: boolean): boolean {
    const pending = this.pendingMissedApprovals.get(automationId);
    if (!pending) return false;
    this.pendingMissedApprovals.delete(automationId);

    if (approveRun) {
      const wf = this.storage.getAutomationById(automationId);
      if (wf) {
        this.onTriggerFire(wf, 'schedule_missed_approved', {
          missedScheduledAt: pending.missedScheduledAt
        });
      }
    }
    return true;
  }

  /**
   * Synchronize all enabled workflows' hotkeys, file watchers, and schedule timestamps.
   */
  public syncAllTriggers(): void {
    const settings = this.storage.getAutomationSettings();
    const workflows = this.storage.getAutomations();

    // Clear existing workflow hotkeys & watchers, then re-bind active ones
    this.unregisterAllWorkflowHotkeys();
    this.closeAllFileWatchers();

    if (!settings.engine_enabled) {
      return;
    }

    const now = new Date();
    for (const wf of workflows) {
      if (!wf.isEnabled) {
        if (wf.nextExecutionAt !== null) {
          this.storage.updateAutomationExecutionTimestamps(wf.id, { nextExecutionAt: null });
        }
        continue;
      }

      switch (wf.triggerType) {
        case 'schedule': {
          const cfg = wf.triggerConfig as unknown as ScheduleTriggerConfig;
          const nextIso = TriggerManager.computeNextExecutionAt(cfg, now);
          if (wf.nextExecutionAt !== nextIso) {
            this.storage.updateAutomationExecutionTimestamps(wf.id, {
              nextExecutionAt: nextIso
            });
          }
          break;
        }
        case 'hotkey': {
          const cfg = wf.triggerConfig as unknown as HotkeyTriggerConfig;
          this.registerWorkflowHotkey(wf, cfg.shortcut);
          break;
        }
        case 'file_watch': {
          const cfg = wf.triggerConfig as unknown as FileWatchTriggerConfig;
          this.startFileWatcher(wf, cfg, settings.file_watcher_debounce_ms);
          break;
        }
        case 'startup':
          break;
      }
    }
  }

  /**
   * Validate a workflow hotkey without permanently registering it.
   */
  public validateHotkeyAvailability(
    shortcutRaw: string,
    excludeAutomationId?: number
  ): { valid: boolean; normalized: string; error?: string } {
    if (!shortcutRaw || typeof shortcutRaw !== 'string' || !shortcutRaw.trim()) {
      return { valid: false, normalized: '', error: 'Hotkey cannot be empty.' };
    }

    const normalized = shortcutRaw
      .trim()
      .replace(/\s+/g, '')
      .replace(/^Ctrl\+/i, 'CommandOrControl+');

    const hasModifier = /(CommandOrControl|Ctrl|Alt|Shift|Super)/i.test(normalized);
    const parts = normalized.split('+').filter(Boolean);
    if (!hasModifier || parts.length < 2) {
      return {
        valid: false,
        normalized,
        error: 'Shortcut must include at least one modifier (Ctrl, Alt, Shift) and a key.'
      };
    }

    // Check against main app toggle shortcut
    const appShortcut = this.shortcutManager.getCurrentAccelerator();
    if (appShortcut.toLowerCase() === normalized.toLowerCase()) {
      return {
        valid: false,
        normalized,
        error: `Shortcut "${normalized}" conflicts with the main Assistant toggle shortcut.`
      };
    }

    // Check against other enabled workflow hotkeys
    const allWorkflows = this.storage.getAutomations();
    for (const wf of allWorkflows) {
      if (excludeAutomationId && wf.id === excludeAutomationId) continue;
      if (wf.isEnabled && wf.triggerType === 'hotkey') {
        const otherShortcut = String(wf.triggerConfig.shortcut || '')
          .trim()
          .replace(/\s+/g, '')
          .replace(/^Ctrl\+/i, 'CommandOrControl+');
        if (otherShortcut.toLowerCase() === normalized.toLowerCase()) {
          return {
            valid: false,
            normalized,
            error: `Shortcut "${normalized}" is already used by workflow "${wf.name}".`
          };
        }
      }
    }

    return { valid: true, normalized };
  }

  private registerWorkflowHotkey(workflow: AutomationWorkflow, rawShortcut: string): boolean {
    const check = this.validateHotkeyAvailability(rawShortcut, workflow.id);
    if (!check.valid) {
      return false;
    }

    try {
      const ok = globalShortcut.register(check.normalized, () => {
        const freshWf = this.storage.getAutomationById(workflow.id);
        if (freshWf && freshWf.isEnabled) {
          this.onTriggerFire(freshWf, 'hotkey', { shortcut: check.normalized });
        }
      });
      if (ok) {
        this.registeredHotkeys.set(workflow.id, check.normalized);
      }
      return ok;
    } catch {
      return false;
    }
  }

  private unregisterAllWorkflowHotkeys(): void {
    for (const accel of this.registeredHotkeys.values()) {
      try {
        // Only unregister if it is not the main app shortcut
        if (accel.toLowerCase() !== this.shortcutManager.getCurrentAccelerator().toLowerCase()) {
          globalShortcut.unregister(accel);
        }
      } catch {
        // Ignore
      }
    }
    this.registeredHotkeys.clear();
  }

  /**
   * Check for missed schedules on startup and advance next_execution_at.
   */
  public recoverAndSyncSchedules(now: Date = new Date()): void {
    const settings = this.storage.getAutomationSettings();
    if (!settings.engine_enabled) return;

    const nowIso = TriggerManager.toLocalIsoMinute(now);
    const workflows = this.storage.getAutomations();

    for (const wf of workflows) {
      if (!wf.isEnabled || wf.triggerType !== 'schedule') continue;
      const cfg = wf.triggerConfig as unknown as ScheduleTriggerConfig;

      const persistedNext = wf.nextExecutionAt;
      const nextFuture = TriggerManager.computeNextExecutionAt(cfg, now);

      if (persistedNext && persistedNext < nowIso) {
        const alreadyRanAfterScheduled =
          wf.lastExecutedAt && wf.lastExecutedAt.slice(0, 16) >= persistedNext;

        this.storage.updateAutomationExecutionTimestamps(wf.id, {
          nextExecutionAt: nextFuture
        });

        // If frequency is 'once' and it was in the past, disable after handling
        if (cfg.frequency === 'once') {
          this.storage.toggleAutomation(wf.id, false);
        }

        if (!alreadyRanAfterScheduled) {
          const policy: MissedSchedulePolicy =
            cfg.missedPolicy || settings.missed_schedule_policy || 'run_once';

          if (policy === 'run_once') {
            this.onTriggerFire(wf, 'schedule_missed_recovery', {
              missedScheduledAt: persistedNext
            });
          } else if (policy === 'ask_user') {
            this.pendingMissedApprovals.set(wf.id, {
              automationId: wf.id,
              workflowName: wf.name,
              missedScheduledAt: persistedNext
            });
          }
          // If 'skip', we already updated nextExecutionAt to nextFuture
        }
      } else {
        this.storage.updateAutomationExecutionTimestamps(wf.id, {
          nextExecutionAt: nextFuture
        });
      }
    }
  }

  /**
   * Evaluate due schedule triggers at `now`.
   */
  public tickSchedules(now: Date = new Date()): void {
    const settings = this.storage.getAutomationSettings();
    if (!settings.engine_enabled) return;

    const nowIso = TriggerManager.toLocalIsoMinute(now);
    const workflows = this.storage.getAutomations();

    for (const wf of workflows) {
      if (!wf.isEnabled || wf.triggerType !== 'schedule') continue;
      const cfg = wf.triggerConfig as unknown as ScheduleTriggerConfig;

      if (!wf.nextExecutionAt) {
        const computed = TriggerManager.computeNextExecutionAt(cfg, now);
        this.storage.updateAutomationExecutionTimestamps(wf.id, { nextExecutionAt: computed });
        continue;
      }

      if (wf.nextExecutionAt <= nowIso) {
        const dedupKey = `${wf.id}:${wf.nextExecutionAt}`;
        if (this.lastFiredMinuteKey.get(wf.id) === dedupKey) {
          continue;
        }
        this.lastFiredMinuteKey.set(wf.id, dedupKey);

        // Compute the next occurrence after the current minute
        const nextMinuteDate = new Date(now.getTime() + 60_000);
        const nextFuture =
          cfg.frequency === 'once'
            ? null
            : TriggerManager.computeNextExecutionAt(cfg, nextMinuteDate);

        this.storage.updateAutomationExecutionTimestamps(wf.id, {
          lastExecutedAt: now.toISOString(),
          nextExecutionAt: nextFuture
        });

        if (cfg.frequency === 'once') {
          this.storage.toggleAutomation(wf.id, false);
        }

        this.onTriggerFire(wf, 'schedule', {
          scheduledAt: wf.nextExecutionAt
        });
      }
    }
  }

  private scheduleStartupWorkflows(): void {
    const settings = this.storage.getAutomationSettings();
    if (!settings.engine_enabled) return;

    const workflows = this.storage.getAutomations();
    for (const wf of workflows) {
      if (!wf.isEnabled || wf.triggerType !== 'startup') continue;
      const cfg = wf.triggerConfig as unknown as StartupTriggerConfig;
      if (cfg.oncePerSession !== false && this.startupExecutedThisSession.has(wf.id)) {
        continue;
      }

      const delayMs = Math.max(0, Number(cfg.delaySeconds || 0) * 1000);
      const timer = setTimeout(() => {
        this.startupTimers.delete(wf.id);
        const freshWf = this.storage.getAutomationById(wf.id);
        if (freshWf && freshWf.isEnabled) {
          this.startupExecutedThisSession.add(wf.id);
          this.onTriggerFire(freshWf, 'startup', { delaySeconds: cfg.delaySeconds || 0 });
        }
      }, delayMs);

      this.startupTimers.set(wf.id, timer);
    }
  }

  /**
   * Manually trigger startup workflows (used by tests or diagnostics).
   */
  public triggerStartupWorkflowsNow(): number {
    const settings = this.storage.getAutomationSettings();
    if (!settings.engine_enabled) return 0;

    let count = 0;
    const workflows = this.storage.getAutomations();
    for (const wf of workflows) {
      if (!wf.isEnabled || wf.triggerType !== 'startup') continue;
      const cfg = wf.triggerConfig as unknown as StartupTriggerConfig;
      if (cfg.oncePerSession !== false && this.startupExecutedThisSession.has(wf.id)) {
        continue;
      }
      this.startupExecutedThisSession.add(wf.id);
      count++;
      this.onTriggerFire(wf, 'startup', { delaySeconds: 0 });
    }
    return count;
  }

  private startFileWatcher(
    workflow: AutomationWorkflow,
    config: FileWatchTriggerConfig,
    defaultDebounceMs: number
  ): void {
    const pathVal = SecurityValidator.validateLocalPath(config.folderPath);
    if (!pathVal.valid || !pathVal.resolvedPath) {
      return;
    }

    const folderPath = pathVal.resolvedPath;
    if (!fs.existsSync(folderPath)) {
      return;
    }

    try {
      const stat = fs.statSync(folderPath);
      if (!stat.isDirectory()) return;

      const initialSnapshot = this.takeDirectorySnapshot(folderPath);
      const debounceMs = Math.max(100, Number(config.debounceMs ?? defaultDebounceMs) || 400);

      const watcher = fs.watch(
        folderPath,
        { recursive: Boolean(config.includeSubdirectories) },
        () => {
          const active = this.activeFileWatchers.get(workflow.id);
          if (!active) return;

          if (active.debounceTimer) {
            clearTimeout(active.debounceTimer);
          }

          active.debounceTimer = setTimeout(() => {
            this.processDirectoryChanges(workflow.id, config);
          }, debounceMs);
        }
      );

      watcher.on('error', () => {
        this.stopFileWatcher(workflow.id);
      });

      this.activeFileWatchers.set(workflow.id, {
        automationId: workflow.id,
        folderPath,
        watcher,
        debounceTimer: null,
        snapshot: initialSnapshot
      });
    } catch {
      // Ignore watch setup failure on inaccessible directories
    }
  }

  private processDirectoryChanges(
    automationId: number,
    config: FileWatchTriggerConfig
  ): void {
    const active = this.activeFileWatchers.get(automationId);
    if (!active) return;

    const freshWf = this.storage.getAutomationById(automationId);
    if (!freshWf || !freshWf.isEnabled) {
      this.stopFileWatcher(automationId);
      return;
    }

    const prevSnapshot = active.snapshot;
    const nextSnapshot = this.takeDirectorySnapshot(active.folderPath);
    active.snapshot = nextSnapshot;

    const addedFiles: string[] = [];
    const deletedFiles: string[] = [];
    const changedFiles: string[] = [];

    for (const [relName, info] of nextSnapshot.entries()) {
      const prev = prevSnapshot.get(relName);
      if (!prev) {
        addedFiles.push(relName);
      } else if (prev.mtimeMs !== info.mtimeMs || prev.size !== info.size) {
        changedFiles.push(relName);
      }
    }

    for (const relName of prevSnapshot.keys()) {
      if (!nextSnapshot.has(relName)) {
        deletedFiles.push(relName);
      }
    }

    const detectedEvents: Array<{
      eventType: FileWatchEventType;
      fileName: string;
      filePath: string;
      oldFileName?: string;
    }> = [];

    const wantsRenamed = (config.events || []).includes('renamed');
    if (wantsRenamed && addedFiles.length === 1 && deletedFiles.length === 1) {
      const newFile = addedFiles[0];
      const oldFile = deletedFiles[0];
      detectedEvents.push({
        eventType: 'renamed',
        fileName: newFile,
        filePath: path.join(active.folderPath, newFile),
        oldFileName: oldFile
      });
    } else {
      for (const f of addedFiles) {
        detectedEvents.push({
          eventType: 'created',
          fileName: f,
          filePath: path.join(active.folderPath, f)
        });
      }
      for (const f of deletedFiles) {
        detectedEvents.push({
          eventType: 'deleted',
          fileName: f,
          filePath: path.join(active.folderPath, f)
        });
      }
    }

    for (const f of changedFiles) {
      detectedEvents.push({
        eventType: 'changed',
        fileName: f,
        filePath: path.join(active.folderPath, f)
      });
    }

    const allowedEvents = new Set(
      Array.isArray(config.events) && config.events.length > 0
        ? config.events
        : (['created', 'changed', 'deleted', 'renamed'] as FileWatchEventType[])
    );

    for (const ev of detectedEvents) {
      if (!allowedEvents.has(ev.eventType)) continue;
      if (!this.matchesFileFilters(ev.fileName, config)) continue;

      this.onTriggerFire(freshWf, `file_watch:${ev.eventType}`, {
        eventType: ev.eventType,
        fileName: ev.fileName,
        filePath: ev.filePath,
        oldFileName: ev.oldFileName || null,
        folderPath: active.folderPath
      });
    }
  }

  private matchesFileFilters(fileName: string, config: FileWatchTriggerConfig): boolean {
    const base = path.basename(fileName).toLowerCase();
    const ext = path.extname(base).toLowerCase();

    if (config.extensionFilter && config.extensionFilter.trim()) {
      const allowedExts = config.extensionFilter
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean)
        .map((e) => (e.startsWith('.') ? e : `.${e}`));
      if (allowedExts.length > 0 && !allowedExts.includes(ext)) {
        return false;
      }
    }

    if (config.fileNamePattern && config.fileNamePattern.trim()) {
      const pattern = config.fileNamePattern.trim().toLowerCase();
      if (pattern.includes('*')) {
        const regexStr =
          '^' +
          pattern
            .split('*')
            .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .join('.*') +
          '$';
        const regex = new RegExp(regexStr, 'i');
        if (!regex.test(base)) return false;
      } else if (!base.includes(pattern)) {
        return false;
      }
    }

    return true;
  }

  private takeDirectorySnapshot(folderPath: string): Map<string, FileSnapshotEntry> {
    const map = new Map<string, FileSnapshotEntry>();
    try {
      const entries = fs.readdirSync(folderPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        try {
          const full = path.join(folderPath, entry.name);
          const stat = fs.statSync(full);
          map.set(entry.name, { mtimeMs: Math.floor(stat.mtimeMs), size: stat.size });
        } catch {
          // Ignore transient locked files
        }
      }
    } catch {
      // Directory unreadable
    }
    return map;
  }

  private stopFileWatcher(automationId: number): void {
    const active = this.activeFileWatchers.get(automationId);
    if (!active) return;
    if (active.debounceTimer) {
      clearTimeout(active.debounceTimer);
    }
    try {
      active.watcher.close();
    } catch {
      // Ignore
    }
    this.activeFileWatchers.delete(automationId);
  }

  private closeAllFileWatchers(): void {
    for (const id of Array.from(this.activeFileWatchers.keys())) {
      this.stopFileWatcher(id);
    }
  }

  /**
   * Compute the next local execution timestamp ("YYYY-MM-DDTHH:MM") for a ScheduleTriggerConfig
   * strictly at or after `referenceDate`.
   */
  public static computeNextExecutionAt(
    config: ScheduleTriggerConfig,
    referenceDate: Date = new Date()
  ): string | null {
    if (!config || !config.frequency) return null;

    const refIso = TriggerManager.toLocalIsoMinute(referenceDate);
    const timeStr = (config.time || '08:00').trim();
    const [hhRaw, mmRaw] = timeStr.split(':').map((n) => Number(n));
    const targetHour = Number.isNaN(hhRaw) ? 8 : Math.min(23, Math.max(0, hhRaw));
    const targetMin = Number.isNaN(mmRaw) ? 0 : Math.min(59, Math.max(0, mmRaw));

    const startDateStr = config.startDate?.trim() || '';
    const endDateStr = config.endDate?.trim() || '';

    if (config.frequency === 'once') {
      const onceDt = (config.onceDateTime || '').trim().slice(0, 16);
      if (!onceDt) return null;
      return onceDt >= refIso ? onceDt : null;
    }

    // Iterate day by day up to 400 days ahead to find the next valid occurrence
    const startSearch = new Date(
      referenceDate.getFullYear(),
      referenceDate.getMonth(),
      referenceDate.getDate(),
      targetHour,
      targetMin,
      0,
      0
    );

    const maxDays = config.frequency === 'yearly' ? 1500 : 400;
    for (let offset = 0; offset <= maxDays; offset++) {
      const candidate = new Date(
        startSearch.getFullYear(),
        startSearch.getMonth(),
        startSearch.getDate() + offset,
        targetHour,
        targetMin,
        0,
        0
      );

      const candidateIso = TriggerManager.toLocalIsoMinute(candidate);
      const candidateDateStr = candidateIso.slice(0, 10);

      if (candidateIso < refIso) {
        continue;
      }
      if (startDateStr && candidateDateStr < startDateStr) {
        continue;
      }
      if (endDateStr && candidateDateStr > endDateStr) {
        return null;
      }

      if (config.frequency === 'daily') {
        return candidateIso;
      }

      if (config.frequency === 'weekly') {
        const weekdays =
          Array.isArray(config.weekdays) && config.weekdays.length > 0
            ? config.weekdays.map((d) => Number(d))
            : [1]; // Default Monday
        if (weekdays.includes(candidate.getDay())) {
          return candidateIso;
        }
      }

      if (config.frequency === 'monthly') {
        const desiredDay = Math.min(31, Math.max(1, Number(config.dayOfMonth || 1)));
        const daysInMonth = new Date(
          candidate.getFullYear(),
          candidate.getMonth() + 1,
          0
        ).getDate();
        const effectiveDay = Math.min(desiredDay, daysInMonth);
        if (candidate.getDate() === effectiveDay) {
          return candidateIso;
        }
      }

      if (config.frequency === 'yearly') {
        const desiredMonth = Math.min(12, Math.max(1, Number(config.monthOfYear || 1)));
        const desiredDay = Math.min(31, Math.max(1, Number(config.dayOfMonth || 1)));
        if (candidate.getMonth() + 1 === desiredMonth) {
          const daysInMonth = new Date(
            candidate.getFullYear(),
            candidate.getMonth() + 1,
            0
          ).getDate();
          const effectiveDay = Math.min(desiredDay, daysInMonth);
          if (candidate.getDate() === effectiveDay) {
            return candidateIso;
          }
        }
      }
    }

    return null;
  }

  public static toLocalIsoMinute(d: Date): string {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
  }
}
