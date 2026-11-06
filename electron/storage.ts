import Database from 'better-sqlite3';
import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export type ThemeMode = 'dark' | 'light';

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

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  global_hotkey: 'CommandOrControl+Shift+Space',
  start_with_windows: false
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

  private runMigrations(): void {
    if (!this.db) {
      throw new Error('Database is not initialized.');
    }

    const migrationPath = path.join(
      app.getAppPath(),
      'database',
      'migrations',
      '001_initial_schema.sql'
    );

    if (fs.existsSync(migrationPath)) {
      const sql = fs.readFileSync(migrationPath, 'utf-8');
      this.db.exec(sql);
    } else {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS settings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          key TEXT NOT NULL UNIQUE,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_settings_key ON settings(key);
      `);
    }
  }

  private seedDefaults(): void {
    if (!this.db) {
      throw new Error('Database is not initialized.');
    }

    const insertDefaultStmt = this.db.prepare(`
      INSERT OR IGNORE INTO settings (key, value, updated_at)
      VALUES (@key, @value, datetime('now'))
    `);

    const seedTransaction = this.db.transaction(() => {
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
    });

    seedTransaction();
  }

  public getDatabasePath(): string {
    return this.dbPath;
  }

  public getSetting(key: string): string | null {
    try {
      if (!this.db) {
        throw new Error('Database is not initialized.');
      }
      const stmt = this.db.prepare('SELECT value FROM settings WHERE key = ?');
      const row = stmt.get(key) as { value: string } | undefined;
      return row ? row.value : null;
    } catch (error) {
      console.error(`[StorageService] Error reading setting "${key}":`, error);
      return null;
    }
  }

  public setSetting(key: string, value: string): boolean {
    try {
      if (!this.db) {
        throw new Error('Database is not initialized.');
      }
      const stmt = this.db.prepare(`
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
      if (!this.db) {
        throw new Error('Database is not initialized.');
      }
      const stmt = this.db.prepare(
        'SELECT id, key, value, updated_at FROM settings ORDER BY id ASC'
      );
      return stmt.all() as SettingRow[];
    } catch (error) {
      console.error('[StorageService] Error listing settings rows:', error);
      return [];
    }
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
