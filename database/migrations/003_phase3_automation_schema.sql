-- Phase 3 SQLite Migration: Auto Task Bot & Workflow Automation Engine
-- Tables: automations, automation_executions, automation_action_logs, automation_settings

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

CREATE INDEX IF NOT EXISTS idx_automations_enabled ON automations(is_enabled);
CREATE INDEX IF NOT EXISTS idx_automations_trigger_type ON automations(trigger_type);
CREATE INDEX IF NOT EXISTS idx_automations_next_exec ON automations(next_execution_at);

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

CREATE INDEX IF NOT EXISTS idx_auto_exec_automation_id ON automation_executions(automation_id);
CREATE INDEX IF NOT EXISTS idx_auto_exec_status ON automation_executions(status);
CREATE INDEX IF NOT EXISTS idx_auto_exec_started_at ON automation_executions(started_at DESC);

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

CREATE INDEX IF NOT EXISTS idx_auto_action_logs_exec_id ON automation_action_logs(execution_id, action_index ASC);

CREATE TABLE IF NOT EXISTS automation_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  setting_key TEXT NOT NULL UNIQUE,
  setting_value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_auto_settings_key ON automation_settings(setting_key);
