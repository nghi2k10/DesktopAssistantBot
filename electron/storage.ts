import Database from 'better-sqlite3';
import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import {
  AutomationActionLogRow,
  AutomationDashboardStats,
  AutomationExecutionRow,
  AutomationRow,
  AutomationSettingsMap,
  AutomationWorkflow,
  ConditionGroup,
  ExecutionPolicy,
  ExecutionStatus,
  MissedSchedulePolicy,
  PendingMissedApproval,
  TriggerType,
  WorkflowActionStep
} from './automation/types';
import {
  computeNextLunarReminderOccurrence,
  LeapMonthPolicy
} from './services/lunar-calendar';

export type ThemeMode = 'dark' | 'light';
export type TaskStatus = 'todo' | 'in_progress' | 'done';
export type TaskPriority = 'low' | 'medium' | 'high';
export type NoteColor = 'slate' | 'blue' | 'emerald' | 'amber' | 'rose' | 'purple';
export type RecurrenceType = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';

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

export interface CreateTaskInput {
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  category_id?: number | null;
  due_at?: string | null;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  category_id?: number | null;
  due_at?: string | null;
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

export interface CreateNoteInput {
  title?: string;
  content?: string;
  color?: NoteColor;
  is_pinned?: boolean;
}

export interface UpdateNoteInput {
  title?: string;
  content?: string;
  color?: NoteColor;
  is_pinned?: boolean;
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

export interface CreateReminderInput {
  title: string;
  description?: string;
  trigger_at: string;
  recurrence_type?: RecurrenceType;
  recurrence_value?: string | null;
  is_enabled?: boolean;
}

export interface UpdateReminderInput {
  title?: string;
  description?: string;
  trigger_at?: string;
  recurrence_type?: RecurrenceType;
  recurrence_value?: string | null;
  is_enabled?: boolean;
  is_completed?: boolean;
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

export interface CreateLunarReminderInput {
  title: string;
  description?: string;
  lunar_day: number;
  lunar_month: number;
  leap_month_policy?: LeapMonthPolicy;
  trigger_time?: string;
  is_enabled?: boolean;
}

export interface UpdateLunarReminderInput {
  title?: string;
  description?: string;
  lunar_day?: number;
  lunar_month?: number;
  leap_month_policy?: LeapMonthPolicy;
  trigger_time?: string;
  is_enabled?: boolean;
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

export interface CreateAutomationInput {
  name: string;
  description?: string;
  isEnabled?: boolean;
  triggerType: TriggerType;
  triggerConfig: Record<string, unknown>;
  conditionConfig?: ConditionGroup;
  actions: WorkflowActionStep[];
  executionPolicy?: Partial<ExecutionPolicy>;
  nextExecutionAt?: string | null;
}

export interface UpdateAutomationInput {
  name?: string;
  description?: string;
  isEnabled?: boolean;
  triggerType?: TriggerType;
  triggerConfig?: Record<string, unknown>;
  conditionConfig?: ConditionGroup;
  actions?: WorkflowActionStep[];
  executionPolicy?: Partial<ExecutionPolicy>;
  lastExecutedAt?: string | null;
  nextExecutionAt?: string | null;
}

export interface ExecutionHistoryFilter {
  automationId?: number;
  status?: ExecutionStatus | 'all';
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  global_hotkey: 'CommandOrControl+Shift+Space',
  start_with_windows: false
};

export const DEFAULT_AUTOMATION_SETTINGS: AutomationSettingsMap = {
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

export class StorageService {
  private db: Database.Database | null = null;
  private readonly dbPath: string;

  constructor(customDbPath?: string) {
    const userDataDir = app.getPath('userData');
    fs.mkdirSync(userDataDir, { recursive: true });
    this.dbPath = customDbPath || path.join(userDataDir, 'desktop-assistant-bot.db');
  }

  public init(): void {
    try {
      this.db = new Database(this.dbPath);
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('foreign_keys = ON');

      this.runMigrations();
      this.seedDefaults();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to initialize SQLite database at ${this.dbPath}: ${message}`);
    }
  }

  private ensureDb(): Database.Database {
    if (!this.db) {
      throw new Error('Database is not initialized.');
    }
    return this.db;
  }

  private runMigrations(): void {
    const db = this.ensureDb();

    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    const migrations: Array<{ version: number; file: string; fallbackSql: string }> = [
      {
        version: 1,
        file: '001_initial_schema.sql',
        fallbackSql: `
          CREATE TABLE IF NOT EXISTS settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key TEXT NOT NULL UNIQUE,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
          CREATE INDEX IF NOT EXISTS idx_settings_key ON settings(key);
        `
      },
      {
        version: 2,
        file: '002_phase2_productivity_schema.sql',
        fallbackSql: `
          CREATE TABLE IF NOT EXISTS task_categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            color TEXT NOT NULL DEFAULT '#3b82f6',
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
          CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL CHECK(status IN ('todo', 'in_progress', 'done')) DEFAULT 'todo',
            priority TEXT NOT NULL CHECK(priority IN ('low', 'medium', 'high')) DEFAULT 'medium',
            category_id INTEGER NULL REFERENCES task_categories(id) ON DELETE SET NULL,
            due_at TEXT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            completed_at TEXT NULL
          );
          CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL DEFAULT 'Untitled Note',
            content TEXT NOT NULL DEFAULT '',
            color TEXT NOT NULL DEFAULT 'slate',
            is_pinned INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
          CREATE TABLE IF NOT EXISTS reminders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            trigger_at TEXT NOT NULL,
            recurrence_type TEXT NOT NULL CHECK(recurrence_type IN ('none', 'daily', 'weekly', 'monthly', 'yearly')) DEFAULT 'none',
            recurrence_value TEXT NULL,
            is_enabled INTEGER NOT NULL DEFAULT 1,
            is_completed INTEGER NOT NULL DEFAULT 0,
            last_notified_at TEXT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
          CREATE TABLE IF NOT EXISTS lunar_reminders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            lunar_day INTEGER NOT NULL CHECK(lunar_day BETWEEN 1 AND 30),
            lunar_month INTEGER NOT NULL CHECK(lunar_month BETWEEN 1 AND 12),
            leap_month_policy TEXT NOT NULL CHECK(leap_month_policy IN ('regular_only', 'leap_only', 'both')) DEFAULT 'regular_only',
            trigger_time TEXT NOT NULL DEFAULT '08:00',
            is_enabled INTEGER NOT NULL DEFAULT 1,
            last_notified_at TEXT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
          CREATE TABLE IF NOT EXISTS reminder_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            reminder_source TEXT NOT NULL CHECK(reminder_source IN ('solar', 'lunar')),
            reminder_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            scheduled_for TEXT NOT NULL,
            notified_at TEXT NOT NULL DEFAULT (datetime('now')),
            was_missed INTEGER NOT NULL DEFAULT 0
          );
        `
      },
      {
        version: 3,
        file: '003_phase3_automation_schema.sql',
        fallbackSql: `
          CREATE TABLE IF NOT EXISTS automations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            is_enabled INTEGER NOT NULL DEFAULT 1,
            trigger_type TEXT NOT NULL CHECK(trigger_type IN ('schedule', 'hotkey', 'startup', 'file_watch')),
            trigger_config TEXT NOT NULL DEFAULT '{}',
            condition_config TEXT NOT NULL DEFAULT '{"operator":"AND","conditions":[]}',
            action_config TEXT NOT NULL DEFAULT '[]',
            execution_policy TEXT NOT NULL DEFAULT '{"onError":"stop","timeoutMs":60000,"maxRetries":0,"retryDelayMs":1000,"allowConcurrent":false}',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            last_executed_at TEXT NULL,
            next_execution_at TEXT NULL
          );
          CREATE TABLE IF NOT EXISTS automation_executions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            automation_id INTEGER NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
            workflow_name TEXT NOT NULL DEFAULT '',
            trigger_type TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('running', 'success', 'failed', 'skipped', 'cancelled')),
            started_at TEXT NOT NULL DEFAULT (datetime('now')),
            finished_at TEXT NULL,
            duration_ms INTEGER NOT NULL DEFAULT 0,
            error_message TEXT NULL,
            execution_context TEXT NOT NULL DEFAULT '{}'
          );
          CREATE TABLE IF NOT EXISTS automation_action_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            execution_id INTEGER NOT NULL REFERENCES automation_executions(id) ON DELETE CASCADE,
            action_index INTEGER NOT NULL,
            action_type TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('running', 'success', 'failed', 'skipped', 'cancelled')),
            started_at TEXT NOT NULL DEFAULT (datetime('now')),
            finished_at TEXT NULL,
            duration_ms INTEGER NOT NULL DEFAULT 0,
            input_summary TEXT NOT NULL DEFAULT '',
            output_summary TEXT NOT NULL DEFAULT '',
            error_message TEXT NULL
          );
          CREATE TABLE IF NOT EXISTS automation_settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            setting_key TEXT NOT NULL UNIQUE,
            setting_value TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
        `
      }
    ];

    const checkMigrationStmt = db.prepare(
      'SELECT version FROM schema_migrations WHERE version = ?'
    );
    const recordMigrationStmt = db.prepare(
      "INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (?, ?, datetime('now'))"
    );

    for (const m of migrations) {
      const existing = checkMigrationStmt.get(m.version);
      const migrationPath = path.join(app.getAppPath(), 'database', 'migrations', m.file);
      const sql = fs.existsSync(migrationPath)
        ? fs.readFileSync(migrationPath, 'utf-8')
        : m.fallbackSql;

      const applyTx = db.transaction(() => {
        db.exec(sql);
        if (!existing) {
          recordMigrationStmt.run(m.version, m.file);
        }
      });
      applyTx();
    }
  }

  private seedDefaults(): void {
    const db = this.ensureDb();

    const insertDefaultStmt = db.prepare(`
      INSERT OR IGNORE INTO settings (key, value, updated_at)
      VALUES (@key, @value, datetime('now'))
    `);

    const insertCategoryStmt = db.prepare(`
      INSERT OR IGNORE INTO task_categories (name, color, created_at)
      VALUES (@name, @color, datetime('now'))
    `);

    const insertAutoSettingStmt = db.prepare(`
      INSERT OR IGNORE INTO automation_settings (setting_key, setting_value, updated_at)
      VALUES (@key, @value, datetime('now'))
    `);

    const defaultCategories = [
      { name: 'General', color: '#3b82f6' },
      { name: 'Work', color: '#8b5cf6' },
      { name: 'Personal', color: '#10b981' },
      { name: 'Study', color: '#f59e0b' },
      { name: 'Urgent', color: '#ef4444' }
    ];

    const seedTransaction = db.transaction(() => {
      insertDefaultStmt.run({
        key: 'theme',
        value: DEFAULT_SETTINGS.theme
      });
      insertDefaultStmt.run({
        key: 'global_hotkey',
        value: DEFAULT_SETTINGS.global_hotkey
      });
      insertDefaultStmt.run({
        key: 'start_with_windows',
        value: String(DEFAULT_SETTINGS.start_with_windows)
      });

      for (const cat of defaultCategories) {
        insertCategoryStmt.run(cat);
      }

      insertAutoSettingStmt.run({
        key: 'engine_enabled',
        value: String(DEFAULT_AUTOMATION_SETTINGS.engine_enabled)
      });
      insertAutoSettingStmt.run({
        key: 'max_concurrent_workflows',
        value: String(DEFAULT_AUTOMATION_SETTINGS.max_concurrent_workflows)
      });
      insertAutoSettingStmt.run({
        key: 'default_timeout_ms',
        value: String(DEFAULT_AUTOMATION_SETTINGS.default_timeout_ms)
      });
      insertAutoSettingStmt.run({
        key: 'default_error_policy',
        value: DEFAULT_AUTOMATION_SETTINGS.default_error_policy
      });
      insertAutoSettingStmt.run({
        key: 'missed_schedule_policy',
        value: DEFAULT_AUTOMATION_SETTINGS.missed_schedule_policy
      });
      insertAutoSettingStmt.run({
        key: 'history_retention_days',
        value: String(DEFAULT_AUTOMATION_SETTINGS.history_retention_days)
      });
      insertAutoSettingStmt.run({
        key: 'notifications_enabled',
        value: String(DEFAULT_AUTOMATION_SETTINGS.notifications_enabled)
      });
      insertAutoSettingStmt.run({
        key: 'file_watcher_debounce_ms',
        value: String(DEFAULT_AUTOMATION_SETTINGS.file_watcher_debounce_ms)
      });
      insertAutoSettingStmt.run({
        key: 'trusted_app_paths',
        value: JSON.stringify(DEFAULT_AUTOMATION_SETTINGS.trusted_app_paths)
      });
    });

    seedTransaction();
  }

  public getDatabasePath(): string {
    return this.dbPath;
  }

  // ==========================================================================
  // Phase 1 Settings Repository
  // ==========================================================================

  public getSetting(key: string): string | null {
    try {
      const db = this.ensureDb();
      const stmt = db.prepare('SELECT value FROM settings WHERE key = ?');
      const row = stmt.get(key) as { value: string } | undefined;
      return row ? row.value : null;
    } catch (error) {
      console.error(`[StorageService] Error reading setting "${key}":`, error);
      return null;
    }
  }

  public setSetting(key: string, value: string): boolean {
    try {
      const db = this.ensureDb();
      const stmt = db.prepare(`
        INSERT INTO settings (key, value, updated_at)
        VALUES (@key, @value, datetime('now'))
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = datetime('now')
      `);
      stmt.run({ key, value });
      return true;
    } catch (error) {
      console.error(`[StorageService] Error saving setting "${key}":`, error);
      return false;
    }
  }

  public getAllSettings(): AppSettings {
    const rawTheme = this.getSetting('theme');
    const theme: ThemeMode = rawTheme === 'light' ? 'light' : 'dark';

    const globalHotkey =
      this.getSetting('global_hotkey') || DEFAULT_SETTINGS.global_hotkey;

    const rawStartWithWindows = this.getSetting('start_with_windows');
    const startWithWindows = rawStartWithWindows === 'true';

    return {
      theme,
      global_hotkey: globalHotkey,
      start_with_windows: startWithWindows
    };
  }

  public getSettingsRows(): SettingRow[] {
    try {
      const db = this.ensureDb();
      const stmt = db.prepare(
        'SELECT id, key, value, updated_at FROM settings ORDER BY id ASC'
      );
      return stmt.all() as SettingRow[];
    } catch (error) {
      console.error('[StorageService] Error listing settings rows:', error);
      return [];
    }
  }

  // ==========================================================================
  // Module 1: Todo List & Categories Repository
  // ==========================================================================

  public getTaskCategories(): TaskCategoryRow[] {
    const db = this.ensureDb();
    return db
      .prepare('SELECT id, name, color, created_at FROM task_categories ORDER BY id ASC')
      .all() as TaskCategoryRow[];
  }

  public createTaskCategory(name: string, color = '#3b82f6'): TaskCategoryRow {
    const db = this.ensureDb();
    const cleanName = name.trim();
    if (!cleanName) {
      throw new Error('Category name cannot be empty.');
    }
    db.prepare(`
      INSERT INTO task_categories (name, color, created_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(name) DO UPDATE SET color = excluded.color
    `).run(cleanName, color);

    return db
      .prepare('SELECT id, name, color, created_at FROM task_categories WHERE name = ?')
      .get(cleanName) as TaskCategoryRow;
  }

  public getTasks(): TaskRow[] {
    const db = this.ensureDb();
    return db
      .prepare(`
        SELECT
          t.id,
          t.title,
          t.description,
          t.status,
          t.priority,
          t.category_id,
          COALESCE(c.name, 'General') AS category_name,
          COALESCE(c.color, '#3b82f6') AS category_color,
          t.due_at,
          t.created_at,
          t.updated_at,
          t.completed_at
        FROM tasks t
        LEFT JOIN task_categories c ON t.category_id = c.id
        ORDER BY t.id DESC
      `)
      .all() as TaskRow[];
  }

  public getTaskById(id: number): TaskRow | null {
    const db = this.ensureDb();
    const row = db
      .prepare(`
        SELECT
          t.id,
          t.title,
          t.description,
          t.status,
          t.priority,
          t.category_id,
          COALESCE(c.name, 'General') AS category_name,
          COALESCE(c.color, '#3b82f6') AS category_color,
          t.due_at,
          t.created_at,
          t.updated_at,
          t.completed_at
        FROM tasks t
        LEFT JOIN task_categories c ON t.category_id = c.id
        WHERE t.id = ?
      `)
      .get(id) as TaskRow | undefined;
    return row || null;
  }

  public getTaskStats(): TaskStats {
    const tasks = this.getTasks();
    const nowMs = Date.now();
    const total = tasks.length;
    let completed = 0;
    let todo = 0;
    let inProgress = 0;
    let overdue = 0;

    for (const t of tasks) {
      if (t.status === 'done') {
        completed++;
      } else {
        if (t.status === 'todo') todo++;
        if (t.status === 'in_progress') inProgress++;
        if (t.due_at) {
          const dueTime = new Date(t.due_at).getTime();
          if (!Number.isNaN(dueTime) && dueTime < nowMs) {
            overdue++;
          }
        }
      }
    }

    const pending = total - completed;
    const completionPercentage = total > 0 ? Math.round((completed / total) * 100) : 0;

    return {
      total,
      completed,
      pending,
      todo,
      inProgress,
      overdue,
      completionPercentage
    };
  }

  public createTask(input: CreateTaskInput): TaskRow {
    const db = this.ensureDb();
    const title = input.title.trim();
    if (!title) {
      throw new Error('Task title is required.');
    }
    const description = (input.description || '').trim();
    const status: TaskStatus = input.status || 'todo';
    const priority: TaskPriority = input.priority || 'medium';
    const categoryId = input.category_id ?? 1;
    const dueAt = input.due_at && input.due_at.trim() ? input.due_at.trim() : null;
    const completedAt = status === 'done' ? new Date().toISOString() : null;

    const info = db
      .prepare(`
        INSERT INTO tasks (title, description, status, priority, category_id, due_at, created_at, updated_at, completed_at)
        VALUES (@title, @description, @status, @priority, @category_id, @due_at, datetime('now'), datetime('now'), @completed_at)
      `)
      .run({
        title,
        description,
        status,
        priority,
        category_id: categoryId,
        due_at: dueAt,
        completed_at: completedAt
      });

    const created = this.getTaskById(Number(info.lastInsertRowid));
    if (!created) {
      throw new Error('Failed to retrieve newly created task.');
    }
    return created;
  }

  public updateTask(id: number, input: UpdateTaskInput): TaskRow {
    const db = this.ensureDb();
    const existing = this.getTaskById(id);
    if (!existing) {
      throw new Error(`Task #${id} not found.`);
    }

    const title = input.title !== undefined ? input.title.trim() : existing.title;
    if (!title) {
      throw new Error('Task title cannot be empty.');
    }
    const description =
      input.description !== undefined ? input.description.trim() : existing.description;
    const status: TaskStatus = input.status !== undefined ? input.status : existing.status;
    const priority: TaskPriority =
      input.priority !== undefined ? input.priority : existing.priority;
    const categoryId =
      input.category_id !== undefined ? input.category_id : existing.category_id;
    const dueAt =
      input.due_at !== undefined
        ? input.due_at && input.due_at.trim()
          ? input.due_at.trim()
          : null
        : existing.due_at;

    let completedAt = existing.completed_at;
    if (status === 'done' && existing.status !== 'done') {
      completedAt = new Date().toISOString();
    } else if (status !== 'done') {
      completedAt = null;
    }

    db.prepare(`
      UPDATE tasks
      SET
        title = @title,
        description = @description,
        status = @status,
        priority = @priority,
        category_id = @category_id,
        due_at = @due_at,
        updated_at = datetime('now'),
        completed_at = @completed_at
      WHERE id = @id
    `).run({
      id,
      title,
      description,
      status,
      priority,
      category_id: categoryId,
      due_at: dueAt,
      completed_at: completedAt
    });

    const updated = this.getTaskById(id);
    if (!updated) {
      throw new Error('Failed to load updated task.');
    }
    return updated;
  }

  public deleteTask(id: number): boolean {
    const db = this.ensureDb();
    const res = db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
    return res.changes > 0;
  }

  // ==========================================================================
  // Module 2: Quick Notes Repository
  // ==========================================================================

  public getNotes(): NoteRow[] {
    const db = this.ensureDb();
    return db
      .prepare(`
        SELECT id, title, content, color, is_pinned, created_at, updated_at
        FROM notes
        ORDER BY is_pinned DESC, updated_at DESC, id DESC
      `)
      .all() as NoteRow[];
  }

  public getNoteById(id: number): NoteRow | null {
    const db = this.ensureDb();
    const row = db
      .prepare(
        'SELECT id, title, content, color, is_pinned, created_at, updated_at FROM notes WHERE id = ?'
      )
      .get(id) as NoteRow | undefined;
    return row || null;
  }

  public createNote(input: CreateNoteInput = {}): NoteRow {
    const db = this.ensureDb();
    const title = (input.title ?? 'Untitled Note').trim() || 'Untitled Note';
    const content = input.content ?? '';
    const color: NoteColor = input.color || 'slate';
    const isPinned = input.is_pinned ? 1 : 0;

    const info = db
      .prepare(`
        INSERT INTO notes (title, content, color, is_pinned, created_at, updated_at)
        VALUES (@title, @content, @color, @is_pinned, datetime('now'), datetime('now'))
      `)
      .run({
        title,
        content,
        color,
        is_pinned: isPinned
      });

    const created = this.getNoteById(Number(info.lastInsertRowid));
    if (!created) {
      throw new Error('Failed to retrieve created note.');
    }
    return created;
  }

  public updateNote(id: number, input: UpdateNoteInput): NoteRow {
    const db = this.ensureDb();
    const existing = this.getNoteById(id);
    if (!existing) {
      throw new Error(`Note #${id} not found.`);
    }

    const title =
      input.title !== undefined
        ? input.title.trim() || 'Untitled Note'
        : existing.title;
    const content = input.content !== undefined ? input.content : existing.content;
    const color: NoteColor = input.color !== undefined ? input.color : existing.color;
    const isPinned =
      input.is_pinned !== undefined ? (input.is_pinned ? 1 : 0) : existing.is_pinned;

    db.prepare(`
      UPDATE notes
      SET
        title = @title,
        content = @content,
        color = @color,
        is_pinned = @is_pinned,
        updated_at = datetime('now')
      WHERE id = @id
    `).run({
      id,
      title,
      content,
      color,
      is_pinned: isPinned
    });

    const updated = this.getNoteById(id);
    if (!updated) {
      throw new Error('Failed to load updated note.');
    }
    return updated;
  }

  public deleteNote(id: number): boolean {
    const db = this.ensureDb();
    const res = db.prepare('DELETE FROM notes WHERE id = ?').run(id);
    return res.changes > 0;
  }

  // ==========================================================================
  // Module 3 & 4: Reminders & Lunar Reminders Repository
  // ==========================================================================

  public getReminders(): ReminderRow[] {
    const db = this.ensureDb();
    return db
      .prepare(`
        SELECT
          id,
          title,
          description,
          trigger_at,
          recurrence_type,
          recurrence_value,
          is_enabled,
          is_completed,
          last_notified_at,
          created_at,
          updated_at
        FROM reminders
        ORDER BY is_completed ASC, trigger_at ASC, id DESC
      `)
      .all() as ReminderRow[];
  }

  public getReminderById(id: number): ReminderRow | null {
    const db = this.ensureDb();
    const row = db
      .prepare('SELECT * FROM reminders WHERE id = ?')
      .get(id) as ReminderRow | undefined;
    return row || null;
  }

  public createReminder(input: CreateReminderInput): ReminderRow {
    const db = this.ensureDb();
    const title = input.title.trim();
    if (!title) {
      throw new Error('Reminder title is required.');
    }
    if (!input.trigger_at || Number.isNaN(new Date(input.trigger_at).getTime())) {
      throw new Error('Valid trigger date and time is required.');
    }

    const description = (input.description || '').trim();
    const recurrenceType: RecurrenceType = input.recurrence_type || 'none';
    const recurrenceValue = input.recurrence_value ?? null;
    const isEnabled = input.is_enabled === false ? 0 : 1;

    const info = db
      .prepare(`
        INSERT INTO reminders (
          title,
          description,
          trigger_at,
          recurrence_type,
          recurrence_value,
          is_enabled,
          is_completed,
          last_notified_at,
          created_at,
          updated_at
        )
        VALUES (
          @title,
          @description,
          @trigger_at,
          @recurrence_type,
          @recurrence_value,
          @is_enabled,
          0,
          NULL,
          datetime('now'),
          datetime('now')
        )
      `)
      .run({
        title,
        description,
        trigger_at: input.trigger_at.trim(),
        recurrence_type: recurrenceType,
        recurrence_value: recurrenceValue,
        is_enabled: isEnabled
      });

    const created = this.getReminderById(Number(info.lastInsertRowid));
    if (!created) {
      throw new Error('Failed to load created reminder.');
    }
    return created;
  }

  public updateReminder(id: number, input: UpdateReminderInput): ReminderRow {
    const db = this.ensureDb();
    const existing = this.getReminderById(id);
    if (!existing) {
      throw new Error(`Reminder #${id} not found.`);
    }

    const title = input.title !== undefined ? input.title.trim() : existing.title;
    if (!title) {
      throw new Error('Reminder title cannot be empty.');
    }
    const description =
      input.description !== undefined ? input.description.trim() : existing.description;
    const triggerAt =
      input.trigger_at !== undefined ? input.trigger_at.trim() : existing.trigger_at;
    const recurrenceType: RecurrenceType =
      input.recurrence_type !== undefined
        ? input.recurrence_type
        : existing.recurrence_type;
    const recurrenceValue =
      input.recurrence_value !== undefined
        ? input.recurrence_value
        : existing.recurrence_value;
    const isEnabled =
      input.is_enabled !== undefined ? (input.is_enabled ? 1 : 0) : existing.is_enabled;
    const isCompleted =
      input.is_completed !== undefined
        ? input.is_completed
          ? 1
          : 0
        : existing.is_completed;

    const resetLastNotified =
      input.trigger_at !== undefined && input.trigger_at.trim() !== existing.trigger_at;

    db.prepare(`
      UPDATE reminders
      SET
        title = @title,
        description = @description,
        trigger_at = @trigger_at,
        recurrence_type = @recurrence_type,
        recurrence_value = @recurrence_value,
        is_enabled = @is_enabled,
        is_completed = @is_completed,
        last_notified_at = @last_notified_at,
        updated_at = datetime('now')
      WHERE id = @id
    `).run({
      id,
      title,
      description,
      trigger_at: triggerAt,
      recurrence_type: recurrenceType,
      recurrence_value: recurrenceValue,
      is_enabled: isEnabled,
      is_completed: isCompleted,
      last_notified_at: resetLastNotified ? null : existing.last_notified_at
    });

    const updated = this.getReminderById(id);
    if (!updated) {
      throw new Error('Failed to load updated reminder.');
    }
    return updated;
  }

  public deleteReminder(id: number): boolean {
    const db = this.ensureDb();
    const res = db.prepare('DELETE FROM reminders WHERE id = ?').run(id);
    return res.changes > 0;
  }

  private enrichLunarReminder(
    raw: Omit<
      LunarReminderRow,
      'next_solar_date' | 'next_trigger_at' | 'next_lunar_year' | 'next_is_leap'
    >
  ): LunarReminderRow {
    const nextOcc = computeNextLunarReminderOccurrence(
      raw.lunar_day,
      raw.lunar_month,
      raw.leap_month_policy,
      raw.trigger_time
    );
    return {
      ...raw,
      next_solar_date: nextOcc.isoDate,
      next_trigger_at: nextOcc.triggerAtIso,
      next_lunar_year: nextOcc.lunarYear,
      next_is_leap: nextOcc.isLeapOccurrence
    };
  }

  public getLunarReminders(): LunarReminderRow[] {
    const db = this.ensureDb();
    const rawRows = db
      .prepare('SELECT * FROM lunar_reminders ORDER BY lunar_month ASC, lunar_day ASC, id DESC')
      .all() as Array<
      Omit<
        LunarReminderRow,
        'next_solar_date' | 'next_trigger_at' | 'next_lunar_year' | 'next_is_leap'
      >
    >;
    return rawRows.map((r) => this.enrichLunarReminder(r));
  }

  public getLunarReminderById(id: number): LunarReminderRow | null {
    const db = this.ensureDb();
    const raw = db
      .prepare('SELECT * FROM lunar_reminders WHERE id = ?')
      .get(id) as
      | Omit<
          LunarReminderRow,
          'next_solar_date' | 'next_trigger_at' | 'next_lunar_year' | 'next_is_leap'
        >
      | undefined;
    return raw ? this.enrichLunarReminder(raw) : null;
  }

  public createLunarReminder(input: CreateLunarReminderInput): LunarReminderRow {
    const db = this.ensureDb();
    const title = input.title.trim();
    if (!title) {
      throw new Error('Lunar reminder title is required.');
    }
    const lunarDay = Number(input.lunar_day);
    const lunarMonth = Number(input.lunar_month);
    if (lunarDay < 1 || lunarDay > 30 || lunarMonth < 1 || lunarMonth > 12) {
      throw new Error('Lunar day must be 1..30 and lunar month must be 1..12.');
    }

    const description = (input.description || '').trim();
    const leapPolicy: LeapMonthPolicy = input.leap_month_policy || 'regular_only';
    const triggerTime = input.trigger_time || '08:00';
    const isEnabled = input.is_enabled === false ? 0 : 1;

    const info = db
      .prepare(`
        INSERT INTO lunar_reminders (
          title,
          description,
          lunar_day,
          lunar_month,
          leap_month_policy,
          trigger_time,
          is_enabled,
          last_notified_at,
          created_at,
          updated_at
        )
        VALUES (
          @title,
          @description,
          @lunar_day,
          @lunar_month,
          @leap_month_policy,
          @trigger_time,
          @is_enabled,
          NULL,
          datetime('now'),
          datetime('now')
        )
      `)
      .run({
        title,
        description,
        lunar_day: lunarDay,
        lunar_month: lunarMonth,
        leap_month_policy: leapPolicy,
        trigger_time: triggerTime,
        is_enabled: isEnabled
      });

    const created = this.getLunarReminderById(Number(info.lastInsertRowid));
    if (!created) {
      throw new Error('Failed to load created lunar reminder.');
    }
    return created;
  }

  public updateLunarReminder(id: number, input: UpdateLunarReminderInput): LunarReminderRow {
    const db = this.ensureDb();
    const existing = this.getLunarReminderById(id);
    if (!existing) {
      throw new Error(`Lunar Reminder #${id} not found.`);
    }

    const title = input.title !== undefined ? input.title.trim() : existing.title;
    const description =
      input.description !== undefined ? input.description.trim() : existing.description;
    const lunarDay =
      input.lunar_day !== undefined ? Number(input.lunar_day) : existing.lunar_day;
    const lunarMonth =
      input.lunar_month !== undefined ? Number(input.lunar_month) : existing.lunar_month;
    const leapPolicy: LeapMonthPolicy =
      input.leap_month_policy !== undefined
        ? input.leap_month_policy
        : existing.leap_month_policy;
    const triggerTime =
      input.trigger_time !== undefined ? input.trigger_time : existing.trigger_time;
    const isEnabled =
      input.is_enabled !== undefined ? (input.is_enabled ? 1 : 0) : existing.is_enabled;

    db.prepare(`
      UPDATE lunar_reminders
      SET
        title = @title,
        description = @description,
        lunar_day = @lunar_day,
        lunar_month = @lunar_month,
        leap_month_policy = @leap_month_policy,
        trigger_time = @trigger_time,
        is_enabled = @is_enabled,
        updated_at = datetime('now')
      WHERE id = @id
    `).run({
      id,
      title,
      description,
      lunar_day: lunarDay,
      lunar_month: lunarMonth,
      leap_month_policy: leapPolicy,
      trigger_time: triggerTime,
      is_enabled: isEnabled
    });

    const updated = this.getLunarReminderById(id);
    if (!updated) {
      throw new Error('Failed to load updated lunar reminder.');
    }
    return updated;
  }

  public deleteLunarReminder(id: number): boolean {
    const db = this.ensureDb();
    const res = db.prepare('DELETE FROM lunar_reminders WHERE id = ?').run(id);
    return res.changes > 0;
  }

  public getReminderHistory(limit = 50): ReminderHistoryRow[] {
    const db = this.ensureDb();
    return db
      .prepare(`
        SELECT id, reminder_source, reminder_id, title, description, scheduled_for, notified_at, was_missed
        FROM reminder_history
        ORDER BY id DESC
        LIMIT ?
      `)
      .all(limit) as ReminderHistoryRow[];
  }

  public recordSolarReminderTriggered(
    reminderId: number,
    scheduledFor: string,
    notifiedAtIso: string,
    wasMissed: boolean,
    nextTriggerAt: string | null,
    markCompleted: boolean
  ): void {
    const db = this.ensureDb();
    const existing = this.getReminderById(reminderId);
    if (!existing) return;

    const tx = db.transaction(() => {
      db.prepare(`
        INSERT INTO reminder_history (
          reminder_source,
          reminder_id,
          title,
          description,
          scheduled_for,
          notified_at,
          was_missed
        )
        VALUES ('solar', @reminder_id, @title, @description, @scheduled_for, @notified_at, @was_missed)
      `).run({
        reminder_id: reminderId,
        title: existing.title,
        description: existing.description,
        scheduled_for: scheduledFor,
        notified_at: notifiedAtIso,
        was_missed: wasMissed ? 1 : 0
      });

      db.prepare(`
        UPDATE reminders
        SET
          trigger_at = @trigger_at,
          last_notified_at = @last_notified_at,
          is_completed = @is_completed,
          updated_at = datetime('now')
        WHERE id = @id
      `).run({
        id: reminderId,
        trigger_at: nextTriggerAt || existing.trigger_at,
        last_notified_at: notifiedAtIso,
        is_completed: markCompleted ? 1 : existing.is_completed
      });
    });

    tx();
  }

  public recordLunarReminderTriggered(
    lunarReminderId: number,
    scheduledFor: string,
    notifiedAtIso: string,
    wasMissed: boolean
  ): void {
    const db = this.ensureDb();
    const existing = this.getLunarReminderById(lunarReminderId);
    if (!existing) return;

    const tx = db.transaction(() => {
      db.prepare(`
        INSERT INTO reminder_history (
          reminder_source,
          reminder_id,
          title,
          description,
          scheduled_for,
          notified_at,
          was_missed
        )
        VALUES ('lunar', @reminder_id, @title, @description, @scheduled_for, @notified_at, @was_missed)
      `).run({
        reminder_id: lunarReminderId,
        title: existing.title,
        description: existing.description,
        scheduled_for: scheduledFor,
        notified_at: notifiedAtIso,
        was_missed: wasMissed ? 1 : 0
      });

      db.prepare(`
        UPDATE lunar_reminders
        SET
          last_notified_at = @last_notified_at,
          updated_at = datetime('now')
        WHERE id = @id
      `).run({
        id: lunarReminderId,
        last_notified_at: notifiedAtIso
      });
    });

    tx();
  }

  // ==========================================================================
  // Phase 3: Auto Task Bot & Workflow Automation Repository
  // ==========================================================================

  private parseAutomationRow(row: AutomationRow): AutomationWorkflow {
    let triggerConfig: Record<string, unknown> = {};
    let conditionConfig: ConditionGroup = { operator: 'AND', conditions: [] };
    let actions: WorkflowActionStep[] = [];
    let executionPolicy: ExecutionPolicy = {
      onError: 'stop',
      timeoutMs: 60000,
      maxRetries: 0,
      retryDelayMs: 1000,
      allowConcurrent: false
    };

    try {
      triggerConfig = JSON.parse(row.trigger_config || '{}');
    } catch {
      triggerConfig = {};
    }
    try {
      const parsedCond = JSON.parse(row.condition_config || '{"operator":"AND","conditions":[]}');
      if (parsedCond && Array.isArray(parsedCond.conditions)) {
        conditionConfig = {
          operator: parsedCond.operator === 'OR' ? 'OR' : 'AND',
          conditions: parsedCond.conditions
        };
      }
    } catch {
      conditionConfig = { operator: 'AND', conditions: [] };
    }
    try {
      const parsedActions = JSON.parse(row.action_config || '[]');
      if (Array.isArray(parsedActions)) {
        actions = parsedActions;
      }
    } catch {
      actions = [];
    }
    try {
      const parsedPol = JSON.parse(row.execution_policy || '{}');
      executionPolicy = {
        onError: parsedPol.onError === 'continue' ? 'continue' : 'stop',
        timeoutMs: Number(parsedPol.timeoutMs) || 60000,
        maxRetries: Number(parsedPol.maxRetries) || 0,
        retryDelayMs: Number(parsedPol.retryDelayMs) || 1000,
        allowConcurrent: Boolean(parsedPol.allowConcurrent)
      };
    } catch {
      // keep default
    }

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      isEnabled: Boolean(row.is_enabled),
      triggerType: row.trigger_type,
      triggerConfig,
      conditionConfig,
      actions,
      executionPolicy,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastExecutedAt: row.last_executed_at,
      nextExecutionAt: row.next_execution_at
    };
  }

  public getAutomations(): AutomationWorkflow[] {
    const db = this.ensureDb();
    const rows = db
      .prepare('SELECT * FROM automations ORDER BY id DESC')
      .all() as AutomationRow[];
    return rows.map((r) => this.parseAutomationRow(r));
  }

  public getAutomationById(id: number): AutomationWorkflow | null {
    const db = this.ensureDb();
    const row = db
      .prepare('SELECT * FROM automations WHERE id = ?')
      .get(id) as AutomationRow | undefined;
    return row ? this.parseAutomationRow(row) : null;
  }

  public createAutomation(input: CreateAutomationInput): AutomationWorkflow {
    const db = this.ensureDb();
    const name = input.name.trim();
    if (!name) {
      throw new Error('Workflow name cannot be empty.');
    }

    const description = (input.description || '').trim();
    const isEnabled = input.isEnabled === false ? 0 : 1;
    const triggerType: TriggerType = input.triggerType;
    const triggerConfigJson = JSON.stringify(input.triggerConfig || {});
    const conditionConfigJson = JSON.stringify(
      input.conditionConfig || { operator: 'AND', conditions: [] }
    );
    const actionConfigJson = JSON.stringify(input.actions || []);
    const settings = this.getAutomationSettings();
    const policy: ExecutionPolicy = {
      onError: input.executionPolicy?.onError || settings.default_error_policy,
      timeoutMs: input.executionPolicy?.timeoutMs ?? settings.default_timeout_ms,
      maxRetries: input.executionPolicy?.maxRetries ?? 0,
      retryDelayMs: input.executionPolicy?.retryDelayMs ?? 1000,
      allowConcurrent: Boolean(input.executionPolicy?.allowConcurrent)
    };
    const policyJson = JSON.stringify(policy);

    const info = db
      .prepare(`
        INSERT INTO automations (
          name,
          description,
          is_enabled,
          trigger_type,
          trigger_config,
          condition_config,
          action_config,
          execution_policy,
          created_at,
          updated_at,
          last_executed_at,
          next_execution_at
        )
        VALUES (
          @name,
          @description,
          @is_enabled,
          @trigger_type,
          @trigger_config,
          @condition_config,
          @action_config,
          @execution_policy,
          datetime('now'),
          datetime('now'),
          NULL,
          @next_execution_at
        )
      `)
      .run({
        name,
        description,
        is_enabled: isEnabled,
        trigger_type: triggerType,
        trigger_config: triggerConfigJson,
        condition_config: conditionConfigJson,
        action_config: actionConfigJson,
        execution_policy: policyJson,
        next_execution_at: input.nextExecutionAt ?? null
      });

    const created = this.getAutomationById(Number(info.lastInsertRowid));
    if (!created) {
      throw new Error('Failed to load created automation workflow.');
    }
    return created;
  }

  public updateAutomation(id: number, input: UpdateAutomationInput): AutomationWorkflow {
    const db = this.ensureDb();
    const existing = this.getAutomationById(id);
    if (!existing) {
      throw new Error(`Automation #${id} not found.`);
    }

    const name = input.name !== undefined ? input.name.trim() : existing.name;
    if (!name) {
      throw new Error('Workflow name cannot be empty.');
    }
    const description =
      input.description !== undefined ? input.description.trim() : existing.description;
    const isEnabled =
      input.isEnabled !== undefined ? (input.isEnabled ? 1 : 0) : existing.isEnabled ? 1 : 0;
    const triggerType =
      input.triggerType !== undefined ? input.triggerType : existing.triggerType;
    const triggerConfig =
      input.triggerConfig !== undefined ? input.triggerConfig : existing.triggerConfig;
    const conditionConfig =
      input.conditionConfig !== undefined ? input.conditionConfig : existing.conditionConfig;
    const actions = input.actions !== undefined ? input.actions : existing.actions;
    const executionPolicy: ExecutionPolicy = {
      ...existing.executionPolicy,
      ...(input.executionPolicy || {})
    };
    const lastExecutedAt =
      input.lastExecutedAt !== undefined ? input.lastExecutedAt : existing.lastExecutedAt;
    const nextExecutionAt =
      input.nextExecutionAt !== undefined ? input.nextExecutionAt : existing.nextExecutionAt;

    db.prepare(`
      UPDATE automations
      SET
        name = @name,
        description = @description,
        is_enabled = @is_enabled,
        trigger_type = @trigger_type,
        trigger_config = @trigger_config,
        condition_config = @condition_config,
        action_config = @action_config,
        execution_policy = @execution_policy,
        updated_at = datetime('now'),
        last_executed_at = @last_executed_at,
        next_execution_at = @next_execution_at
      WHERE id = @id
    `).run({
      id,
      name,
      description,
      is_enabled: isEnabled,
      trigger_type: triggerType,
      trigger_config: JSON.stringify(triggerConfig),
      condition_config: JSON.stringify(conditionConfig),
      action_config: JSON.stringify(actions),
      execution_policy: JSON.stringify(executionPolicy),
      last_executed_at: lastExecutedAt,
      next_execution_at: nextExecutionAt
    });

    const updated = this.getAutomationById(id);
    if (!updated) {
      throw new Error('Failed to load updated automation workflow.');
    }
    return updated;
  }

  public deleteAutomation(id: number): boolean {
    const db = this.ensureDb();
    const res = db.prepare('DELETE FROM automations WHERE id = ?').run(id);
    return res.changes > 0;
  }

  public toggleAutomation(id: number, isEnabled: boolean): AutomationWorkflow {
    return this.updateAutomation(id, { isEnabled });
  }

  public updateAutomationExecutionTimestamps(
    id: number,
    timestamps: { lastExecutedAt?: string | null; nextExecutionAt?: string | null }
  ): AutomationWorkflow | null {
    const existing = this.getAutomationById(id);
    if (!existing) return null;
    return this.updateAutomation(id, timestamps);
  }

  public getLastExecutionForWorkflow(automationId: number): AutomationExecutionRow | null {
    const db = this.ensureDb();
    const row = db
      .prepare(
        'SELECT * FROM automation_executions WHERE automation_id = ? ORDER BY id DESC LIMIT 1'
      )
      .get(automationId) as AutomationExecutionRow | undefined;
    return row || null;
  }

  public getAutomationExecutionById(executionId: number): AutomationExecutionRow | null {
    const db = this.ensureDb();
    const row = db
      .prepare('SELECT * FROM automation_executions WHERE id = ?')
      .get(executionId) as AutomationExecutionRow | undefined;
    return row || null;
  }

  public pruneOldAutomationExecutions(retentionDays: number): number {
    return this.clearOldExecutions(retentionDays);
  }

  public duplicateAutomation(id: number): AutomationWorkflow {
    const existing = this.getAutomationById(id);
    if (!existing) {
      throw new Error(`Automation #${id} not found.`);
    }

    // If hotkey trigger, clear shortcut on duplicate to prevent immediate hotkey conflict
    const duplicatedTriggerConfig = { ...existing.triggerConfig };
    if (existing.triggerType === 'hotkey') {
      duplicatedTriggerConfig.shortcut = '';
    }

    return this.createAutomation({
      name: `${existing.name} (Copy)`,
      description: existing.description,
      isEnabled: false,
      triggerType: existing.triggerType,
      triggerConfig: duplicatedTriggerConfig,
      conditionConfig: existing.conditionConfig,
      actions: existing.actions,
      executionPolicy: existing.executionPolicy,
      nextExecutionAt: null
    });
  }

  // Execution & Action Logs
  public createExecutionRecord(
    automationId: number,
    workflowName: string,
    triggerType: string,
    contextObj: Record<string, unknown> = {}
  ): AutomationExecutionRow {
    const db = this.ensureDb();
    const nowIso = new Date().toISOString();
    const info = db
      .prepare(`
        INSERT INTO automation_executions (
          automation_id,
          workflow_name,
          trigger_type,
          status,
          started_at,
          finished_at,
          duration_ms,
          error_message,
          execution_context
        )
        VALUES (
          @automation_id,
          @workflow_name,
          @trigger_type,
          'running',
          @started_at,
          NULL,
          0,
          NULL,
          @execution_context
        )
      `)
      .run({
        automation_id: automationId,
        workflow_name: workflowName,
        trigger_type: triggerType,
        started_at: nowIso,
        execution_context: JSON.stringify(contextObj)
      });

    return db
      .prepare('SELECT * FROM automation_executions WHERE id = ?')
      .get(Number(info.lastInsertRowid)) as AutomationExecutionRow;
  }

  public finishExecutionRecord(
    executionId: number,
    status: ExecutionStatus,
    durationMs: number,
    errorMessage: string | null = null
  ): void {
    const db = this.ensureDb();
    const finishedAt = new Date().toISOString();
    db.prepare(`
      UPDATE automation_executions
      SET
        status = @status,
        finished_at = @finished_at,
        duration_ms = @duration_ms,
        error_message = @error_message
      WHERE id = @id
    `).run({
      id: executionId,
      status,
      finished_at: finishedAt,
      duration_ms: Math.max(0, Math.round(durationMs)),
      error_message: errorMessage
    });
  }

  public createActionLogRecord(
    executionId: number,
    actionIndex: number,
    actionType: string,
    inputSummary: string
  ): number {
    const db = this.ensureDb();
    const startedAt = new Date().toISOString();
    const info = db
      .prepare(`
        INSERT INTO automation_action_logs (
          execution_id,
          action_index,
          action_type,
          status,
          started_at,
          finished_at,
          duration_ms,
          input_summary,
          output_summary,
          error_message
        )
        VALUES (
          @execution_id,
          @action_index,
          @action_type,
          'running',
          @started_at,
          NULL,
          0,
          @input_summary,
          '',
          NULL
        )
      `)
      .run({
        execution_id: executionId,
        action_index: actionIndex,
        action_type: actionType,
        started_at: startedAt,
        input_summary: inputSummary.slice(0, 500)
      });

    return Number(info.lastInsertRowid);
  }

  public finishActionLogRecord(
    logId: number,
    status: ExecutionStatus,
    durationMs: number,
    outputSummary: string,
    errorMessage: string | null = null
  ): void {
    const db = this.ensureDb();
    const finishedAt = new Date().toISOString();
    db.prepare(`
      UPDATE automation_action_logs
      SET
        status = @status,
        finished_at = @finished_at,
        duration_ms = @duration_ms,
        output_summary = @output_summary,
        error_message = @error_message
      WHERE id = @id
    `).run({
      id: logId,
      status,
      finished_at: finishedAt,
      duration_ms: Math.max(0, Math.round(durationMs)),
      output_summary: outputSummary.slice(0, 1000),
      error_message: errorMessage ? errorMessage.slice(0, 1000) : null
    });
  }

  public getExecutions(filter: ExecutionHistoryFilter = {}): {
    items: AutomationExecutionRow[];
    total: number;
  } {
    const db = this.ensureDb();
    const clauses: string[] = [];
    const params: Record<string, unknown> = {};

    if (filter.automationId) {
      clauses.push('automation_id = @automationId');
      params.automationId = filter.automationId;
    }
    if (filter.status && filter.status !== 'all') {
      clauses.push('status = @status');
      params.status = filter.status;
    }
    if (filter.dateFrom) {
      clauses.push('started_at >= @dateFrom');
      params.dateFrom = filter.dateFrom;
    }
    if (filter.dateTo) {
      clauses.push('started_at <= @dateTo');
      params.dateTo = `${filter.dateTo}T23:59:59.999Z`;
    }
    if (filter.search && filter.search.trim()) {
      clauses.push(
        '(workflow_name LIKE @search OR trigger_type LIKE @search OR COALESCE(error_message, "") LIKE @search)'
      );
      params.search = `%${filter.search.trim()}%`;
    }

    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const countRow = db
      .prepare(`SELECT COUNT(*) as cnt FROM automation_executions ${whereSql}`)
      .get(params) as { cnt: number };

    const limit = Math.min(Math.max(Number(filter.limit) || 50, 1), 200);
    const offset = Math.max(Number(filter.offset) || 0, 0);

    const items = db
      .prepare(
        `SELECT * FROM automation_executions ${whereSql} ORDER BY id DESC LIMIT @limit OFFSET @offset`
      )
      .all({ ...params, limit, offset }) as AutomationExecutionRow[];

    return { items, total: countRow.cnt };
  }

  public getExecutionDetails(executionId: number): {
    execution: AutomationExecutionRow | null;
    actionLogs: AutomationActionLogRow[];
  } {
    const db = this.ensureDb();
    const execution =
      (db
        .prepare('SELECT * FROM automation_executions WHERE id = ?')
        .get(executionId) as AutomationExecutionRow | undefined) || null;
    const actionLogs = db
      .prepare(
        'SELECT * FROM automation_action_logs WHERE execution_id = ? ORDER BY action_index ASC, id ASC'
      )
      .all(executionId) as AutomationActionLogRow[];

    return { execution, actionLogs };
  }

  public deleteExecutionRecord(id: number): boolean {
    const db = this.ensureDb();
    const res = db.prepare('DELETE FROM automation_executions WHERE id = ?').run(id);
    return res.changes > 0;
  }

  public clearOldExecutions(olderThanDays = 0): number {
    const db = this.ensureDb();
    if (olderThanDays <= 0) {
      const res = db.prepare("DELETE FROM automation_executions WHERE status != 'running'").run();
      return res.changes;
    }
    const cutoff = new Date(Date.now() - olderThanDays * 86400000).toISOString();
    const res = db
      .prepare(
        "DELETE FROM automation_executions WHERE status != 'running' AND started_at < ?"
      )
      .run(cutoff);
    return res.changes;
  }

  public getAutomationSettings(): AutomationSettingsMap {
    const db = this.ensureDb();
    const rows = db
      .prepare('SELECT setting_key, setting_value FROM automation_settings')
      .all() as Array<{ setting_key: string; setting_value: string }>;

    const map: Record<string, string> = {};
    for (const r of rows) {
      map[r.setting_key] = r.setting_value;
    }

    let trustedPaths = DEFAULT_AUTOMATION_SETTINGS.trusted_app_paths;
    if (map.trusted_app_paths) {
      try {
        const parsed = JSON.parse(map.trusted_app_paths);
        if (Array.isArray(parsed)) {
          trustedPaths = parsed.map(String);
        }
      } catch {
        // fallback
      }
    }

    return {
      engine_enabled:
        map.engine_enabled !== undefined
          ? map.engine_enabled === 'true'
          : DEFAULT_AUTOMATION_SETTINGS.engine_enabled,
      max_concurrent_workflows:
        Number(map.max_concurrent_workflows) ||
        DEFAULT_AUTOMATION_SETTINGS.max_concurrent_workflows,
      default_timeout_ms:
        Number(map.default_timeout_ms) || DEFAULT_AUTOMATION_SETTINGS.default_timeout_ms,
      default_error_policy:
        map.default_error_policy === 'continue' ? 'continue' : 'stop',
      missed_schedule_policy: (['skip', 'run_once', 'ask_user'].includes(
        map.missed_schedule_policy
      )
        ? map.missed_schedule_policy
        : DEFAULT_AUTOMATION_SETTINGS.missed_schedule_policy) as MissedSchedulePolicy,
      history_retention_days:
        Number(map.history_retention_days) ||
        DEFAULT_AUTOMATION_SETTINGS.history_retention_days,
      notifications_enabled:
        map.notifications_enabled !== undefined
          ? map.notifications_enabled === 'true'
          : DEFAULT_AUTOMATION_SETTINGS.notifications_enabled,
      file_watcher_debounce_ms:
        Number(map.file_watcher_debounce_ms) ||
        DEFAULT_AUTOMATION_SETTINGS.file_watcher_debounce_ms,
      trusted_app_paths: trustedPaths
    };
  }

  public updateAutomationSettings(
    partial: Partial<AutomationSettingsMap>
  ): AutomationSettingsMap {
    const db = this.ensureDb();
    const upsertStmt = db.prepare(`
      INSERT INTO automation_settings (setting_key, setting_value, updated_at)
      VALUES (@key, @value, datetime('now'))
      ON CONFLICT(setting_key) DO UPDATE SET
        setting_value = excluded.setting_value,
        updated_at = datetime('now')
    `);

    const tx = db.transaction(() => {
      if (partial.engine_enabled !== undefined) {
        upsertStmt.run({
          key: 'engine_enabled',
          value: String(Boolean(partial.engine_enabled))
        });
      }
      if (partial.max_concurrent_workflows !== undefined) {
        upsertStmt.run({
          key: 'max_concurrent_workflows',
          value: String(Math.max(1, Math.min(10, Number(partial.max_concurrent_workflows) || 3)))
        });
      }
      if (partial.default_timeout_ms !== undefined) {
        upsertStmt.run({
          key: 'default_timeout_ms',
          value: String(Math.max(1000, Number(partial.default_timeout_ms) || 60000))
        });
      }
      if (partial.default_error_policy !== undefined) {
        upsertStmt.run({
          key: 'default_error_policy',
          value: partial.default_error_policy === 'continue' ? 'continue' : 'stop'
        });
      }
      if (partial.missed_schedule_policy !== undefined) {
        upsertStmt.run({
          key: 'missed_schedule_policy',
          value: partial.missed_schedule_policy
        });
      }
      if (partial.history_retention_days !== undefined) {
        upsertStmt.run({
          key: 'history_retention_days',
          value: String(Math.max(1, Number(partial.history_retention_days) || 30))
        });
      }
      if (partial.notifications_enabled !== undefined) {
        upsertStmt.run({
          key: 'notifications_enabled',
          value: String(Boolean(partial.notifications_enabled))
        });
      }
      if (partial.file_watcher_debounce_ms !== undefined) {
        upsertStmt.run({
          key: 'file_watcher_debounce_ms',
          value: String(Math.max(100, Number(partial.file_watcher_debounce_ms) || 600))
        });
      }
      if (partial.trusted_app_paths !== undefined) {
        upsertStmt.run({
          key: 'trusted_app_paths',
          value: JSON.stringify(partial.trusted_app_paths)
        });
      }
    });

    tx();
    return this.getAutomationSettings();
  }

  public getAutomationDashboardStats(
    runningAutomationsCount: number,
    pendingMissedApprovals: PendingMissedApproval[]
  ): AutomationDashboardStats {
    const db = this.ensureDb();
    const workflows = this.getAutomations();
    const totalAutomations = workflows.length;
    const enabledAutomations = workflows.filter((w) => w.isEnabled).length;
    const disabledAutomations = totalAutomations - enabledAutomations;

    const statusCounts = db
      .prepare(
        'SELECT status, COUNT(*) as cnt FROM automation_executions GROUP BY status'
      )
      .all() as Array<{ status: ExecutionStatus; cnt: number }>;

    const countMap: Record<string, number> = {};
    for (const s of statusCounts) {
      countMap[s.status] = s.cnt;
    }

    const scheduledEnabled = workflows
      .filter((w) => w.isEnabled && w.nextExecutionAt)
      .sort(
        (a, b) =>
          new Date(a.nextExecutionAt!).getTime() - new Date(b.nextExecutionAt!).getTime()
      );

    const nextScheduledWorkflow =
      scheduledEnabled.length > 0
        ? {
            automationId: scheduledEnabled[0].id,
            name: scheduledEnabled[0].name,
            nextExecutionAt: scheduledEnabled[0].nextExecutionAt!
          }
        : null;

    return {
      totalAutomations,
      enabledAutomations,
      disabledAutomations,
      runningAutomations: runningAutomationsCount,
      successfulExecutions: countMap.success || 0,
      failedExecutions: countMap.failed || 0,
      skippedExecutions: countMap.skipped || 0,
      cancelledExecutions: countMap.cancelled || 0,
      nextScheduledWorkflow,
      pendingMissedApprovals
    };
  }

  public close(): void {
    try {
      if (this.db) {
        this.db.close();
        this.db = null;
      }
    } catch (error) {
      console.error('[StorageService] Error closing SQLite database:', error);
    }
  }
}
