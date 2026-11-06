import * as fs from 'fs';
import * as path from 'path';
import { StorageService } from '../../storage';
import { ConditionGroup, ConditionOperator, ConditionRule } from '../types';
import { SecurityValidator } from '../security/path-validator';

export interface ConditionEvaluationDetail {
  ruleId: string;
  type: string;
  passed: boolean;
  actualValue: string;
  expectedValue: string;
  reason: string;
}

export interface ConditionEvaluationResult {
  passed: boolean;
  operator: 'AND' | 'OR';
  details: ConditionEvaluationDetail[];
  summary: string;
}

export class ConditionEngine {
  private storage: StorageService;
  private isWorkflowRunningCallback: (automationId: number) => boolean;

  constructor(
    storage: StorageService,
    isWorkflowRunningCallback: (automationId: number) => boolean
  ) {
    this.storage = storage;
    this.isWorkflowRunningCallback = isWorkflowRunningCallback;
  }

  public evaluateGroup(
    group: ConditionGroup | undefined | null,
    context: Record<string, unknown> = {},
    referenceDate: Date = new Date()
  ): ConditionEvaluationResult {
    if (!group || !Array.isArray(group.conditions) || group.conditions.length === 0) {
      return {
        passed: true,
        operator: group?.operator || 'AND',
        details: [],
        summary: 'No conditions configured (passed by default).'
      };
    }

    const op = group.operator === 'OR' ? 'OR' : 'AND';
    const details: ConditionEvaluationDetail[] = [];

    for (const rule of group.conditions) {
      const detail = this.evaluateRule(rule, context, referenceDate);
      details.push(detail);
    }

    const passed =
      op === 'AND'
        ? details.every((d) => d.passed)
        : details.some((d) => d.passed);

    const passedCount = details.filter((d) => d.passed).length;
    const summary = `Condition group (${op}): ${passedCount}/${details.length} rules matched -> ${
      passed ? 'PASSED' : 'SKIPPED'
    }`;

    return {
      passed,
      operator: op,
      details,
      summary
    };
  }

  public evaluateRule(
    rule: ConditionRule,
    context: Record<string, unknown> = {},
    now: Date = new Date()
  ): ConditionEvaluationDetail {
    const target = (rule.target ?? '').trim();
    const expected = (rule.value ?? '').trim();
    const operator: ConditionOperator = rule.operator || 'equals';

    try {
      switch (rule.type) {
        case 'time_hour': {
          const currentHour = now.getHours();
          const passed = this.compareValues(currentHour, expected, operator);
          return {
            ruleId: rule.id,
            type: rule.type,
            passed,
            actualValue: String(currentHour),
            expectedValue: expected,
            reason: `Current hour (${currentHour}) ${operator} ${expected}`
          };
        }

        case 'time_weekday': {
          const dayNum = now.getDay(); // 0..6
          const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
          const shortNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
          const expLower = expected.toLowerCase();
          let normalizedExpected: string | number = expected;
          if (dayNames.includes(expLower)) {
            normalizedExpected = dayNames.indexOf(expLower);
          } else if (shortNames.includes(expLower)) {
            normalizedExpected = shortNames.indexOf(expLower);
          }
          const passed = this.compareValues(dayNum, String(normalizedExpected), operator);
          return {
            ruleId: rule.id,
            type: rule.type,
            passed,
            actualValue: `${dayNum} (${dayNames[dayNum]})`,
            expectedValue: expected,
            reason: `Current weekday (${dayNum}) ${operator} ${expected}`
          };
        }

        case 'time_date': {
          const yyyy = now.getFullYear();
          const mm = String(now.getMonth() + 1).padStart(2, '0');
          const dd = String(now.getDate()).padStart(2, '0');
          const todayStr = `${yyyy}-${mm}-${dd}`;
          const passed = this.compareValues(todayStr, expected, operator);
          return {
            ruleId: rule.id,
            type: rule.type,
            passed,
            actualValue: todayStr,
            expectedValue: expected,
            reason: `Current date (${todayStr}) ${operator} ${expected}`
          };
        }

        case 'time_date_range': {
          const yyyy = now.getFullYear();
          const mm = String(now.getMonth() + 1).padStart(2, '0');
          const dd = String(now.getDate()).padStart(2, '0');
          const todayStr = `${yyyy}-${mm}-${dd}`;
          let startStr = target;
          let endStr = expected;
          if (!startStr && expected.includes('..')) {
            const parts = expected.split('..');
            startStr = parts[0].trim();
            endStr = (parts[1] || '').trim();
          } else if (!startStr && expected.includes(',')) {
            const parts = expected.split(',');
            startStr = parts[0].trim();
            endStr = (parts[1] || '').trim();
          }
          const inRange =
            (!startStr || todayStr >= startStr) && (!endStr || todayStr <= endStr);
          const passed = operator === 'not_equals' ? !inRange : inRange;
          return {
            ruleId: rule.id,
            type: rule.type,
            passed,
            actualValue: todayStr,
            expectedValue: `${startStr} .. ${endStr}`,
            reason: `Date ${todayStr} in range [${startStr}, ${endStr}]`
          };
        }

        case 'file_exists':
        case 'file_not_exists': {
          const rawPath = target || expected || String(context.filePath || '');
          const validation = SecurityValidator.validateLocalPath(rawPath, {
            allowSystemReadOnly: true
          });
          if (!validation.valid || !validation.resolvedPath) {
            return {
              ruleId: rule.id,
              type: rule.type,
              passed: false,
              actualValue: 'invalid_path',
              expectedValue: rawPath,
              reason: validation.error || 'Invalid file path'
            };
          }
          const exists = fs.existsSync(validation.resolvedPath);
          const passed = rule.type === 'file_exists' ? exists : !exists;
          return {
            ruleId: rule.id,
            type: rule.type,
            passed,
            actualValue: String(exists),
            expectedValue: rule.type === 'file_exists' ? 'true' : 'false',
            reason: `File "${validation.resolvedPath}" exists=${exists}`
          };
        }

        case 'file_extension': {
          const rawPath = target || String(context.filePath || '');
          const ext = path.extname(rawPath).toLowerCase();
          const normalizedExpected = expected.startsWith('.')
            ? expected.toLowerCase()
            : `.${expected.toLowerCase()}`;
          const passed = this.compareValues(ext, normalizedExpected, operator);
          return {
            ruleId: rule.id,
            type: rule.type,
            passed,
            actualValue: ext,
            expectedValue: normalizedExpected,
            reason: `File extension (${ext}) ${operator} ${normalizedExpected}`
          };
        }

        case 'file_size': {
          const rawPath = target || String(context.filePath || '');
          const validation = SecurityValidator.validateLocalPath(rawPath, {
            allowSystemReadOnly: true
          });
          if (!validation.valid || !validation.resolvedPath || !fs.existsSync(validation.resolvedPath)) {
            return {
              ruleId: rule.id,
              type: rule.type,
              passed: false,
              actualValue: 'missing',
              expectedValue: expected,
              reason: `File not found or invalid path: ${rawPath}`
            };
          }
          const stat = fs.statSync(validation.resolvedPath);
          const passed = this.compareValues(stat.size, expected, operator);
          return {
            ruleId: rule.id,
            type: rule.type,
            passed,
            actualValue: String(stat.size),
            expectedValue: expected,
            reason: `File size (${stat.size} B) ${operator} ${expected}`
          };
        }

        case 'todo_incomplete_count': {
          const stats = this.storage.getTaskStats();
          const passed = this.compareValues(stats.pending, expected, operator);
          return {
            ruleId: rule.id,
            type: rule.type,
            passed,
            actualValue: String(stats.pending),
            expectedValue: expected,
            reason: `Incomplete tasks (${stats.pending}) ${operator} ${expected}`
          };
        }

        case 'todo_overdue_count': {
          const stats = this.storage.getTaskStats();
          const passed = this.compareValues(stats.overdue, expected, operator);
          return {
            ruleId: rule.id,
            type: rule.type,
            passed,
            actualValue: String(stats.overdue),
            expectedValue: expected,
            reason: `Overdue tasks (${stats.overdue}) ${operator} ${expected}`
          };
        }

        case 'todo_completed': {
          const tasks = this.storage.getTasks();
          const taskQuery = target || expected;
          const numericId = Number(taskQuery);
          const matchedTask = !Number.isNaN(numericId) && numericId > 0
            ? tasks.find((t) => t.id === numericId)
            : tasks.find((t) => t.title.toLowerCase().includes(taskQuery.toLowerCase()));

          const isDone = matchedTask ? matchedTask.status === 'done' : false;
          const expectedBool = expected.toLowerCase() === 'false' ? false : true;
          const passed = operator === 'not_equals' ? isDone !== expectedBool : isDone === expectedBool;
          return {
            ruleId: rule.id,
            type: rule.type,
            passed,
            actualValue: String(isDone),
            expectedValue: String(expectedBool),
            reason: matchedTask
              ? `Task "${matchedTask.title}" completed=${isDone}`
              : `Task "${taskQuery}" not found`
          };
        }

        case 'workflow_enabled': {
          const wfId = Number(target || expected);
          const wf = this.storage.getAutomationById(wfId);
          const isEnabled = wf ? wf.isEnabled : false;
          const expectedBool = expected.toLowerCase() === 'false' ? false : true;
          const passed = operator === 'not_equals' ? isEnabled !== expectedBool : isEnabled === expectedBool;
          return {
            ruleId: rule.id,
            type: rule.type,
            passed,
            actualValue: String(isEnabled),
            expectedValue: String(expectedBool),
            reason: wf ? `Workflow #${wfId} enabled=${isEnabled}` : `Workflow #${wfId} not found`
          };
        }

        case 'workflow_last_status': {
          const wfId = Number(target);
          const lastExec = this.storage.getLastExecutionForWorkflow(wfId);
          const actualStatus = lastExec ? lastExec.status : 'none';
          const passed = this.compareValues(actualStatus, expected.toLowerCase(), operator);
          return {
            ruleId: rule.id,
            type: rule.type,
            passed,
            actualValue: actualStatus,
            expectedValue: expected,
            reason: `Workflow #${wfId} last status (${actualStatus}) ${operator} ${expected}`
          };
        }

        case 'workflow_is_running': {
          const wfId = Number(target);
          const running = this.isWorkflowRunningCallback(wfId);
          const expectedBool = expected.toLowerCase() === 'true';
          const passed = operator === 'not_equals' ? running !== expectedBool : running === expectedBool;
          return {
            ruleId: rule.id,
            type: rule.type,
            passed,
            actualValue: String(running),
            expectedValue: String(expectedBool),
            reason: `Workflow #${wfId} isRunning=${running}`
          };
        }

        default:
          return {
            ruleId: rule.id,
            type: String(rule.type),
            passed: false,
            actualValue: 'unsupported',
            expectedValue: expected,
            reason: `Unsupported condition type: ${String(rule.type)}`
          };
      }
    } catch (err) {
      return {
        ruleId: rule.id,
        type: rule.type,
        passed: false,
        actualValue: 'error',
        expectedValue: expected,
        reason: err instanceof Error ? err.message : 'Condition evaluation error'
      };
    }
  }

  private compareValues(
    actual: string | number | boolean,
    expectedRaw: string,
    operator: ConditionOperator
  ): boolean {
    if (operator === 'exists') {
      return actual !== null && actual !== undefined && String(actual).trim() !== '' && actual !== false;
    }

    const actualNum = typeof actual === 'number' ? actual : Number(actual);
    const expectedNum = Number(expectedRaw);
    const bothNumeric =
      !Number.isNaN(actualNum) &&
      !Number.isNaN(expectedNum) &&
      String(actual).trim() !== '' &&
      expectedRaw.trim() !== '';

    switch (operator) {
      case 'equals':
        if (bothNumeric) return actualNum === expectedNum;
        return String(actual).toLowerCase() === expectedRaw.toLowerCase();

      case 'not_equals':
        if (bothNumeric) return actualNum !== expectedNum;
        return String(actual).toLowerCase() !== expectedRaw.toLowerCase();

      case 'greater_than':
        if (bothNumeric) return actualNum > expectedNum;
        return String(actual) > expectedRaw;

      case 'less_than':
        if (bothNumeric) return actualNum < expectedNum;
        return String(actual) < expectedRaw;

      case 'contains':
        return String(actual).toLowerCase().includes(expectedRaw.toLowerCase());

      default:
        return false;
    }
  }
}
