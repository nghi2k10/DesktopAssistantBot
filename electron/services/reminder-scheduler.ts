import { app, Notification } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import {
  LunarReminderRow,
  RecurrenceType,
  ReminderRow,
  StorageService
} from '../storage';

export interface ReminderFiredPayload {
  source: 'solar' | 'lunar';
  reminderId: number;
  title: string;
  description: string;
  scheduledFor: string;
  wasMissed: boolean;
}

export class ReminderSchedulerService {
  private readonly storage: StorageService;
  private readonly onNotificationClicked: (payload: {
    source: 'solar' | 'lunar';
    reminderId: number;
  }) => void;
  private readonly onReminderStateChanged: (fired: ReminderFiredPayload) => void;
  private timer: NodeJS.Timeout | null = null;
  private readonly firedOccurrenceKeys: Set<string> = new Set();

  constructor(
    storage: StorageService,
    callbacks: {
      onNotificationClicked: (payload: {
        source: 'solar' | 'lunar';
        reminderId: number;
      }) => void;
      onReminderStateChanged: (fired: ReminderFiredPayload) => void;
    }
  ) {
    this.storage = storage;
    this.onNotificationClicked = callbacks.onNotificationClicked;
    this.onReminderStateChanged = callbacks.onReminderStateChanged;
  }

  public start(intervalMs = 10000): void {
    // Immediate startup check (handles missed reminders after application restart)
    this.checkDueReminders(true);

    if (this.timer) {
      clearInterval(this.timer);
    }
    this.timer = setInterval(() => {
      this.checkDueReminders(false);
    }, intervalMs);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Compute the next future trigger timestamp for a recurring reminder.
   */
  public static computeNextOccurrence(
    currentTriggerAt: string,
    recurrenceType: RecurrenceType,
    now: Date = new Date()
  ): string | null {
    if (recurrenceType === 'none') {
      return null;
    }

    const baseDate = new Date(currentTriggerAt);
    if (Number.isNaN(baseDate.getTime())) {
      return null;
    }

    const next = new Date(baseDate.getTime());
    let guard = 0;

    while (next.getTime() <= now.getTime() && guard < 1000) {
      guard++;
      switch (recurrenceType) {
        case 'daily':
          next.setDate(next.getDate() + 1);
          break;
        case 'weekly':
          next.setDate(next.getDate() + 7);
          break;
        case 'monthly':
          next.setMonth(next.getMonth() + 1);
          break;
        case 'yearly':
          next.setFullYear(next.getFullYear() + 1);
          break;
      }
    }

    const pad = (n: number) => String(n).padStart(2, '0');
    return `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}T${pad(
      next.getHours()
    )}:${pad(next.getMinutes())}`;
  }

  public checkDueReminders(isStartupRecovery = false, customNow?: Date): ReminderFiredPayload[] {
    const now = customNow || new Date();
    const nowMs = now.getTime();
    const nowIso = now.toISOString();
    const firedList: ReminderFiredPayload[] = [];

    // 1. Check standard solar reminders
    const reminders = this.storage.getReminders();
    for (const r of reminders) {
      if (!r.is_enabled || r.is_completed) {
        continue;
      }

      const triggerMs = new Date(r.trigger_at).getTime();
      if (Number.isNaN(triggerMs) || triggerMs > nowMs) {
        continue;
      }

      // Duplicate prevention: check both in-memory Set and persisted last_notified_at
      const dedupKey = `solar:${r.id}:${r.trigger_at}`;
      if (this.firedOccurrenceKeys.has(dedupKey)) {
        continue;
      }

      if (r.last_notified_at) {
        const lastNotifiedMs = new Date(r.last_notified_at).getTime();
        if (!Number.isNaN(lastNotifiedMs) && lastNotifiedMs >= triggerMs) {
          this.firedOccurrenceKeys.add(dedupKey);
          continue;
        }
      }

      this.firedOccurrenceKeys.add(dedupKey);

      // Determine if missed (more than 90 seconds overdue or on startup recovery)
      const wasMissed = isStartupRecovery || nowMs - triggerMs > 90 * 1000;
      const nextTriggerAt = ReminderSchedulerService.computeNextOccurrence(
        r.trigger_at,
        r.recurrence_type,
        now
      );
      const markCompleted = r.recurrence_type === 'none';

      this.storage.recordSolarReminderTriggered(
        r.id,
        r.trigger_at,
        nowIso,
        wasMissed,
        nextTriggerAt,
        markCompleted
      );

      const payload: ReminderFiredPayload = {
        source: 'solar',
        reminderId: r.id,
        title: r.title,
        description: r.description,
        scheduledFor: r.trigger_at,
        wasMissed
      };

      this.dispatchDesktopNotification(payload, r);
      this.onReminderStateChanged(payload);
      firedList.push(payload);
    }

    // 2. Check lunar reminders
    const lunarReminders = this.storage.getLunarReminders();
    for (const lr of lunarReminders) {
      if (!lr.is_enabled) {
        continue;
      }

      const triggerMs = new Date(lr.next_trigger_at).getTime();
      if (Number.isNaN(triggerMs) || triggerMs > nowMs) {
        continue;
      }

      const dedupKey = `lunar:${lr.id}:${lr.next_trigger_at}`;
      if (this.firedOccurrenceKeys.has(dedupKey)) {
        continue;
      }

      if (lr.last_notified_at) {
        const lastNotifiedMs = new Date(lr.last_notified_at).getTime();
        if (!Number.isNaN(lastNotifiedMs) && lastNotifiedMs >= triggerMs) {
          this.firedOccurrenceKeys.add(dedupKey);
          continue;
        }
      }

      this.firedOccurrenceKeys.add(dedupKey);
      const wasMissed = isStartupRecovery || nowMs - triggerMs > 90 * 1000;

      this.storage.recordLunarReminderTriggered(
        lr.id,
        lr.next_trigger_at,
        nowIso,
        wasMissed
      );

      const payload: ReminderFiredPayload = {
        source: 'lunar',
        reminderId: lr.id,
        title: `[Âm lịch ${lr.lunar_day}/${lr.lunar_month}] ${lr.title}`,
        description: lr.description,
        scheduledFor: lr.next_trigger_at,
        wasMissed
      };

      this.dispatchDesktopNotification(payload, lr);
      this.onReminderStateChanged(payload);
      firedList.push(payload);
    }

    return firedList;
  }

  private dispatchDesktopNotification(
    payload: ReminderFiredPayload,
    _raw: ReminderRow | LunarReminderRow
  ): void {
    try {
      if (!Notification.isSupported()) {
        return;
      }

      const iconPath = path.join(app.getAppPath(), 'assets', 'icons', 'icon.png');
      const titlePrefix = payload.wasMissed ? 'Missed Reminder: ' : 'Reminder: ';
      const notification = new Notification({
        title: `${titlePrefix}${payload.title}`,
        body:
          payload.description ||
          `Scheduled for ${payload.scheduledFor.replace('T', ' ')}`,
        icon: fs.existsSync(iconPath) ? iconPath : undefined,
        silent: false
      });

      notification.on('click', () => {
        this.onNotificationClicked({
          source: payload.source,
          reminderId: payload.reminderId
        });
      });

      notification.show();
    } catch (error) {
      console.error('[ReminderSchedulerService] Notification error:', error);
    }
  }
}
