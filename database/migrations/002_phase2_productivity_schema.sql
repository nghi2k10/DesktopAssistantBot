-- Phase 2 SQLite Migration: Personal Productivity Modules
-- Tables: schema_migrations, task_categories, tasks, notes, reminders, lunar_reminders, reminder_history

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

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

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);
CREATE INDEX IF NOT EXISTS idx_tasks_category_id ON tasks(category_id);
CREATE INDEX IF NOT EXISTS idx_tasks_due_at ON tasks(due_at);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);

CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL DEFAULT 'Untitled Note',
  content TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT 'slate',
  is_pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notes_pinned_updated ON notes(is_pinned DESC, updated_at DESC);

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

CREATE INDEX IF NOT EXISTS idx_reminders_trigger_at ON reminders(trigger_at);
CREATE INDEX IF NOT EXISTS idx_reminders_enabled_completed ON reminders(is_enabled, is_completed);

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

CREATE INDEX IF NOT EXISTS idx_lunar_reminders_enabled ON lunar_reminders(is_enabled);
CREATE INDEX IF NOT EXISTS idx_lunar_reminders_month_day ON lunar_reminders(lunar_month, lunar_day);

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

CREATE INDEX IF NOT EXISTS idx_reminder_history_notified_at ON reminder_history(notified_at DESC);
