import { StorageService } from '../../storage';
import { ShortcutManager } from '../../shortcut';
import { ConditionEngine } from '../conditions/condition-engine';
import { ActionRegistry } from '../actions/action-registry';
import { TriggerManager } from '../triggers/trigger-manager';
import { SecurityValidator } from '../security/path-validator';
import {
  AutomationDashboardStats,
  AutomationExecutionRow,
  AutomationWorkflow,
  ConditionGroup,
  ExecutionPolicy,
  ExecutionStatus,
  FileWatchTriggerConfig,
  HotkeyTriggerConfig,
  ScheduleTriggerConfig,
  TriggerType,
  WorkflowActionStep
} from '../types';

interface RunningExecutionHandle {
  executionId: number;
  automationId: number;
  workflowName: string;
  abortController: AbortController;
  startedAtMs: number;
}

export interface WorkflowValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface WorkflowImportPreview {
  valid: boolean;
  errors: string[];
  warnings: string[];
  workflows: Array<{
    name: string;
    description: string;
    triggerType: TriggerType;
    triggerConfig: Record<string, unknown>;
    conditionConfig: ConditionGroup;
    actions: WorkflowActionStep[];
    executionPolicy: ExecutionPolicy;
    hasDuplicateName: boolean;
  }>;
}

export class WorkflowEngine {
  private storage: StorageService;
  private shortcutManager: ShortcutManager;
  private conditionEngine: ConditionEngine;
  private actionRegistry: ActionRegistry;
  private triggerManager: TriggerManager;
  private onStateChanged?: () => void;

  private runningExecutions: Map<number, RunningExecutionHandle> = new Map(); // executionId -> handle
  private isSmokeTestMode = false;

  constructor(
    storage: StorageService,
    shortcutManager: ShortcutManager,
    onStateChanged?: () => void
  ) {
    this.storage = storage;
    this.shortcutManager = shortcutManager;
    this.onStateChanged = onStateChanged;

    this.conditionEngine = new ConditionEngine(storage, (automationId) =>
      this.isWorkflowRunning(automationId)
    );
    this.actionRegistry = new ActionRegistry(storage, this.conditionEngine);
    this.triggerManager = new TriggerManager(
      storage,
      shortcutManager,
      (workflow, triggerSource, payload) => {
        void this.executeWorkflow(workflow.id, {
          triggerSource,
          triggerPayload: payload
        });
      }
    );
  }

  public setSmokeTestMode(enabled: boolean): void {
    this.isSmokeTestMode = enabled;
  }

  public initialize(options: { skipStartupTriggers?: boolean } = {}): void {
    const settings = this.storage.getAutomationSettings();
    this.storage.pruneOldAutomationExecutions(settings.history_retention_days);
    this.triggerManager.initialize(options);
  }

  public dispose(): void {
    this.triggerManager.dispose();
    for (const handle of this.runningExecutions.values()) {
      handle.abortController.abort();
    }
    this.runningExecutions.clear();
  }

  public getTriggerManager(): TriggerManager {
    return this.triggerManager;
  }

  public getConditionEngine(): ConditionEngine {
    return this.conditionEngine;
  }

  public isWorkflowRunning(automationId: number): boolean {
    for (const handle of this.runningExecutions.values()) {
      if (handle.automationId === automationId) {
        return true;
      }
    }
    return false;
  }

  public getRunningWorkflowCount(): number {
    return this.runningExecutions.size;
  }

  public getRunningExecutionIdsForWorkflow(automationId: number): number[] {
    const ids: number[] = [];
    for (const handle of this.runningExecutions.values()) {
      if (handle.automationId === automationId) {
        ids.push(handle.executionId);
      }
    }
    return ids;
  }

  public getDashboardStats(): AutomationDashboardStats {
    return this.storage.getAutomationDashboardStats(
      this.getRunningWorkflowCount(),
      this.triggerManager.getPendingMissedApprovals()
    );
  }

  /**
   * Validate a workflow payload before creating, updating, or importing.
   */
  public validateWorkflowDefinition(
    input: {
      name: string;
      triggerType: TriggerType;
      triggerConfig: Record<string, unknown>;
      conditionConfig: ConditionGroup;
      actions: WorkflowActionStep[];
      executionPolicy?: Partial<ExecutionPolicy>;
    },
    excludeAutomationId?: number
  ): WorkflowValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!input.name || !input.name.trim()) {
      errors.push('Workflow name is required.');
    }

    const validTriggers: TriggerType[] = ['schedule', 'hotkey', 'startup', 'file_watch'];
    if (!validTriggers.includes(input.triggerType)) {
      errors.push(`Invalid trigger type: ${String(input.triggerType)}`);
    } else {
      const tCfg = input.triggerConfig || {};
      if (input.triggerType === 'schedule') {
        const sCfg = tCfg as unknown as ScheduleTriggerConfig;
        if (!sCfg.frequency) {
          errors.push('Schedule trigger requires a frequency (once, daily, weekly, monthly, yearly).');
        }
        if (sCfg.frequency === 'once') {
          if (!sCfg.onceDateTime || !String(sCfg.onceDateTime).trim()) {
            errors.push('One-time schedule trigger requires a date and time.');
          }
        } else {
          if (!sCfg.time || !/^\d{2}:\d{2}$/.test(String(sCfg.time).trim())) {
            errors.push('Schedule trigger requires a valid 24h time in HH:MM format.');
          }
        }
      } else if (input.triggerType === 'hotkey') {
        const hCfg = tCfg as unknown as HotkeyTriggerConfig;
        const hkCheck = this.triggerManager.validateHotkeyAvailability(
          hCfg.shortcut,
          excludeAutomationId
        );
        if (!hkCheck.valid) {
          errors.push(hkCheck.error || 'Invalid hotkey configuration.');
        }
      } else if (input.triggerType === 'file_watch') {
        const fwCfg = tCfg as unknown as FileWatchTriggerConfig;
        const pCheck = SecurityValidator.validateLocalPath(fwCfg.folderPath);
        if (!pCheck.valid) {
          errors.push(`File Watcher folder error: ${pCheck.error}`);
        }
        if (!Array.isArray(fwCfg.events) || fwCfg.events.length === 0) {
          errors.push('File Watcher trigger requires at least one file event (created, changed, deleted, renamed).');
        }
      }
    }

    if (!Array.isArray(input.actions) || input.actions.length === 0) {
      errors.push('Workflow must contain at least one action step.');
    } else {
      const validateStepsRecursive = (steps: WorkflowActionStep[], depth: number) => {
        if (depth > 5) {
          errors.push('Nested If/Else action depth cannot exceed 5 levels.');
          return;
        }
        steps.forEach((step, idx) => {
          const check = this.actionRegistry.validateActionStep(step);
          if (!check.valid) {
            errors.push(`Action #${idx + 1} (${step.type}): ${check.error}`);
          }
          if (step.type === 'if_else') {
            if (Array.isArray(step.thenActions) && step.thenActions.length > 0) {
              validateStepsRecursive(step.thenActions, depth + 1);
            }
            if (Array.isArray(step.elseActions) && step.elseActions.length > 0) {
              validateStepsRecursive(step.elseActions, depth + 1);
            }
          }
        });
      };
      validateStepsRecursive(input.actions, 0);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Execute a workflow by ID (manual, test, retry, or triggered).
   */
  public async executeWorkflow(
    automationId: number,
    options: {
      triggerSource?: string;
      triggerPayload?: Record<string, unknown>;
      isManualOrTest?: boolean;
      skipConditions?: boolean;
    } = {}
  ): Promise<AutomationExecutionRow> {
    const workflow = this.storage.getAutomationById(automationId);
    if (!workflow) {
      throw new Error(`Automation workflow #${automationId} not found.`);
    }

    const settings = this.storage.getAutomationSettings();
    const triggerSource = options.triggerSource || workflow.triggerType;
    const triggerPayload = options.triggerPayload || {};

    if (!options.isManualOrTest && !settings.engine_enabled) {
      return this.recordSkippedExecution(
        workflow,
        triggerSource,
        triggerPayload,
        'Global Automation Engine is currently paused in Settings.'
      );
    }

    // Overlap check for same workflow
    if (!workflow.executionPolicy.allowConcurrent && this.isWorkflowRunning(workflow.id)) {
      return this.recordSkippedExecution(
        workflow,
        triggerSource,
        triggerPayload,
        'Skipped: Workflow is already running and concurrent execution is disabled.'
      );
    }

    // Global max concurrency check
    if (this.getRunningWorkflowCount() >= settings.max_concurrent_workflows) {
      return this.recordSkippedExecution(
        workflow,
        triggerSource,
        triggerPayload,
        `Skipped: Maximum concurrent workflows (${settings.max_concurrent_workflows}) reached.`
      );
    }

    // Create running execution record
    const startedAtMs = Date.now();
    const execRow = this.storage.createExecutionRecord(
      workflow.id,
      workflow.name,
      triggerSource,
      triggerPayload
    );
    const executionId = execRow.id;

    const abortController = new AbortController();
    const handle: RunningExecutionHandle = {
      executionId,
      automationId: workflow.id,
      workflowName: workflow.name,
      abortController,
      startedAtMs
    };
    this.runningExecutions.set(executionId, handle);
    this.notifyStateChanged();

    // Overall workflow timeout timer
    const workflowTimeoutMs = Math.max(
      1000,
      Number(workflow.executionPolicy.timeoutMs || settings.default_timeout_ms || 30_000)
    );
    let timedOut = false;
    const workflowTimeoutTimer = setTimeout(() => {
      timedOut = true;
      abortController.abort();
    }, workflowTimeoutMs);

    try {
      // Step 1: Evaluate Conditions (unless explicitly skipped)
      if (!options.skipConditions) {
        const condResult = this.conditionEngine.evaluateGroup(
          workflow.conditionConfig,
          triggerPayload
        );
        if (!condResult.passed) {
          clearTimeout(workflowTimeoutTimer);
          this.runningExecutions.delete(executionId);
          const durationMs = Date.now() - startedAtMs;
          this.storage.finishExecutionRecord(
            executionId,
            'skipped',
            durationMs,
            condResult.summary
          );
          this.notifyStateChanged();
          return this.storage.getAutomationExecutionById(executionId)!;
        }
      }

      // Step 2: Execute Actions Sequentially
      let actionIndexCounter = 0;
      let encounteredActionError: string | null = null;

      const runStepSequence = async (
        steps: WorkflowActionStep[],
        depth: number
      ): Promise<{ stopped: boolean; summary: string }> => {
        let executedCount = 0;

        for (const step of steps) {
          if (abortController.signal.aborted) {
            throw new Error(
              timedOut
                ? `Workflow timed out after ${workflowTimeoutMs} ms`
                : 'Workflow cancelled by user'
            );
          }

          actionIndexCounter++;
          const currentActionIdx = actionIndexCounter;
          const stepStartMs = Date.now();

          const logId = this.storage.createActionLogRecord(
            executionId,
            currentActionIdx,
            step.type,
            JSON.stringify(step.config || {})
          );

          const maxRetries = Math.max(
            0,
            Number(step.maxRetries ?? workflow.executionPolicy.maxRetries ?? 0)
          );
          const retryDelayMs = Math.max(
            50,
            Number(step.retryDelayMs ?? workflow.executionPolicy.retryDelayMs ?? 500)
          );
          const stepTimeoutMs = Math.max(
            500,
            Number(step.timeoutMs || workflowTimeoutMs)
          );

          let attempt = 0;
          let stepOutput: {
            inputSummary: string;
            outputSummary: string;
            stopWorkflowRequested?: boolean;
          } | null = null;
          let lastStepError: Error | null = null;

          while (attempt <= maxRetries) {
            attempt++;
            try {
              stepOutput = await this.executeStepWithTimeout(
                step,
                stepTimeoutMs,
                {
                  automationId: workflow.id,
                  workflowName: workflow.name,
                  executionId,
                  triggerType: triggerSource,
                  triggerPayload,
                  abortSignal: abortController.signal,
                  isSmokeTest: this.isSmokeTestMode,
                  depth,
                  executeNestedActions: (nestedSteps, nestedDepth) =>
                    runStepSequence(nestedSteps, nestedDepth)
                }
              );
              lastStepError = null;
              break;
            } catch (err) {
              lastStepError = err instanceof Error ? err : new Error(String(err));
              if (abortController.signal.aborted) {
                break;
              }
              if (attempt <= maxRetries) {
                await new Promise((r) => setTimeout(r, retryDelayMs));
              }
            }
          }

          const stepDurationMs = Date.now() - stepStartMs;

          if (lastStepError) {
            const isCancelled = abortController.signal.aborted && !timedOut;
            const stepStatus: ExecutionStatus = isCancelled ? 'cancelled' : 'failed';
            const errMsg =
              attempt > 1
                ? `${lastStepError.message} (after ${attempt} attempts)`
                : lastStepError.message;

            this.storage.finishActionLogRecord(
              logId,
              stepStatus,
              stepDurationMs,
              '',
              errMsg
            );

            if (abortController.signal.aborted) {
              throw lastStepError;
            }

            const effectiveOnError =
              step.onError && step.onError !== 'inherit'
                ? step.onError
                : workflow.executionPolicy.onError || settings.default_error_policy || 'stop';

            encounteredActionError = `Action #${currentActionIdx} (${step.type}) failed: ${errMsg}`;

            if (effectiveOnError === 'stop') {
              throw new Error(encounteredActionError);
            }
            // If 'continue', proceed to the next step
          } else if (stepOutput) {
            executedCount++;
            this.storage.finishActionLogRecord(
              logId,
              'success',
              stepDurationMs,
              attempt > 1
                ? `${stepOutput.outputSummary} (succeeded on attempt ${attempt})`
                : stepOutput.outputSummary,
              null
            );

            if (stepOutput.stopWorkflowRequested) {
              return {
                stopped: true,
                summary: `Stopped after ${executedCount} action(s)`
              };
            }
          }
        }

        return {
          stopped: false,
          summary: `Completed ${executedCount} action(s)`
        };
      };

      await runStepSequence(workflow.actions, 0);

      clearTimeout(workflowTimeoutTimer);
      this.runningExecutions.delete(executionId);
      const durationMs = Date.now() - startedAtMs;

      this.storage.finishExecutionRecord(
        executionId,
        'success',
        durationMs,
        encounteredActionError
          ? `Completed with non-fatal error(s): ${encounteredActionError}`
          : null
      );
      this.storage.updateAutomationExecutionTimestamps(workflow.id, {
        lastExecutedAt: new Date().toISOString()
      });

      this.notifyStateChanged();
      return this.storage.getAutomationExecutionById(executionId)!;
    } catch (err) {
      clearTimeout(workflowTimeoutTimer);
      this.runningExecutions.delete(executionId);
      const durationMs = Date.now() - startedAtMs;

      const isCancelled = abortController.signal.aborted && !timedOut;
      const finalStatus: ExecutionStatus = isCancelled ? 'cancelled' : 'failed';
      const errMsg = timedOut
        ? `Execution timed out after ${workflowTimeoutMs} ms`
        : err instanceof Error
        ? err.message
        : 'Workflow execution failed';

      this.storage.finishExecutionRecord(executionId, finalStatus, durationMs, errMsg);
      this.storage.updateAutomationExecutionTimestamps(workflow.id, {
        lastExecutedAt: new Date().toISOString()
      });

      this.notifyStateChanged();
      return this.storage.getAutomationExecutionById(executionId)!;
    }
  }

  /**
   * Cancel a currently running execution by executionId or automationId.
   */
  public cancelExecution(executionId: number): boolean {
    const handle = this.runningExecutions.get(executionId);
    if (!handle) return false;
    handle.abortController.abort();
    return true;
  }

  public cancelWorkflowExecutions(automationId: number): number {
    let count = 0;
    for (const handle of this.runningExecutions.values()) {
      if (handle.automationId === automationId) {
        handle.abortController.abort();
        count++;
      }
    }
    return count;
  }

  /**
   * Retry a previous execution by looking up its automation_id and context.
   */
  public async retryExecution(executionId: number): Promise<AutomationExecutionRow> {
    const prev = this.storage.getAutomationExecutionById(executionId);
    if (!prev) {
      throw new Error(`Execution #${executionId} not found.`);
    }
    let parsedContext: Record<string, unknown> = {};
    try {
      parsedContext = JSON.parse(prev.execution_context || '{}');
    } catch {
      parsedContext = {};
    }
    return this.executeWorkflow(prev.automation_id, {
      triggerSource: `retry:${prev.trigger_type}`,
      triggerPayload: parsedContext,
      isManualOrTest: true
    });
  }

  /**
   * Export one or all workflows to a formatted JSON string.
   */
  public exportWorkflowsJson(automationIds?: number[]): string {
    const all = this.storage.getAutomations();
    const selected =
      Array.isArray(automationIds) && automationIds.length > 0
        ? all.filter((w) => automationIds.includes(w.id))
        : all;

    const exportBundle = {
      schemaVersion: '3.0',
      application: 'Desktop Assistant Bot',
      exportedAt: new Date().toISOString(),
      workflows: selected.map((wf) => ({
        name: wf.name,
        description: wf.description,
        triggerType: wf.triggerType,
        triggerConfig: wf.triggerConfig,
        conditionConfig: wf.conditionConfig,
        actions: wf.actions,
        executionPolicy: wf.executionPolicy
      }))
    };

    return JSON.stringify(exportBundle, null, 2);
  }

  /**
   * Validate and preview an imported JSON string without saving or executing.
   */
  public validateAndPreviewImport(rawJson: string): WorkflowImportPreview {
    const errors: string[] = [];
    const warnings: string[] = [];
    const parsedWorkflows: WorkflowImportPreview['workflows'] = [];

    if (!rawJson || !rawJson.trim()) {
      return {
        valid: false,
        errors: ['Import JSON cannot be empty.'],
        warnings: [],
        workflows: []
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawJson);
    } catch (err) {
      return {
        valid: false,
        errors: [
          `Malformed JSON file: ${err instanceof Error ? err.message : 'Syntax error'}`
        ],
        warnings: [],
        workflows: []
      };
    }

    const rawObj = parsed as Record<string, unknown>;
    let rawList: unknown[] = [];
    if (Array.isArray(parsed)) {
      rawList = parsed;
    } else if (rawObj && Array.isArray(rawObj.workflows)) {
      rawList = rawObj.workflows;
    } else if (rawObj && typeof rawObj.name === 'string' && rawObj.triggerType) {
      rawList = [rawObj];
    } else {
      return {
        valid: false,
        errors: [
          'Invalid workflow export structure. Expected a "workflows" array or a workflow object.'
        ],
        warnings: [],
        workflows: []
      };
    }

    if (rawList.length === 0) {
      return {
        valid: false,
        errors: ['No workflows found in the JSON payload.'],
        warnings: [],
        workflows: []
      };
    }

    const existingNames = new Set(
      this.storage.getAutomations().map((w) => w.name.toLowerCase())
    );

    rawList.forEach((item, index) => {
      const wfObj = item as Record<string, unknown>;
      const name = String(wfObj?.name || '').trim();
      const description = String(wfObj?.description || '').trim();
      const triggerType = wfObj?.triggerType as TriggerType;
      const triggerConfig =
        wfObj?.triggerConfig && typeof wfObj.triggerConfig === 'object'
          ? (wfObj.triggerConfig as Record<string, unknown>)
          : {};
      const conditionConfig =
        wfObj?.conditionConfig && typeof wfObj.conditionConfig === 'object'
          ? (wfObj.conditionConfig as ConditionGroup)
          : { operator: 'AND' as const, conditions: [] };
      const actions = Array.isArray(wfObj?.actions)
        ? (wfObj.actions as WorkflowActionStep[])
        : [];
      const rawPolicy = (wfObj?.executionPolicy || {}) as Partial<ExecutionPolicy>;
      const executionPolicy: ExecutionPolicy = {
        onError: rawPolicy.onError === 'continue' ? 'continue' : 'stop',
        timeoutMs: Number(rawPolicy.timeoutMs) || 30_000,
        maxRetries: Number(rawPolicy.maxRetries) || 0,
        retryDelayMs: Number(rawPolicy.retryDelayMs) || 1000,
        allowConcurrent: Boolean(rawPolicy.allowConcurrent)
      };

      const validation = this.validateWorkflowDefinition({
        name,
        triggerType,
        triggerConfig,
        conditionConfig,
        actions,
        executionPolicy
      });

      if (!validation.valid) {
        validation.errors.forEach((e) =>
          errors.push(`Workflow #${index + 1} ("${name || 'Unnamed'}"): ${e}`)
        );
      }

      const hasDuplicateName = existingNames.has(name.toLowerCase());
      if (hasDuplicateName) {
        warnings.push(
          `Workflow "${name}" already exists and will be imported as "${name} (Imported)".`
        );
      }

      parsedWorkflows.push({
        name,
        description,
        triggerType,
        triggerConfig,
        conditionConfig,
        actions,
        executionPolicy,
        hasDuplicateName
      });
    });

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      workflows: parsedWorkflows
    };
  }

  /**
   * Import validated workflows into SQLite.
   * Imported workflows are always created in a disabled state (isEnabled: false)
   * and are never auto-executed upon import.
   */
  public importWorkflowsJson(rawJson: string): AutomationWorkflow[] {
    const preview = this.validateAndPreviewImport(rawJson);
    if (!preview.valid) {
      throw new Error(preview.errors.join(' | '));
    }

    const imported: AutomationWorkflow[] = [];
    for (const item of preview.workflows) {
      const finalName = item.hasDuplicateName
        ? `${item.name} (Imported)`
        : item.name;

      const created = this.storage.createAutomation({
        name: finalName,
        description: item.description,
        isEnabled: false, // Never auto-enable or auto-execute imported workflows
        triggerType: item.triggerType,
        triggerConfig: item.triggerConfig,
        conditionConfig: item.conditionConfig,
        actions: item.actions,
        executionPolicy: item.executionPolicy,
        nextExecutionAt: null
      });
      imported.push(created);
    }

    this.notifyStateChanged();
    return imported;
  }

  private async executeStepWithTimeout(
    step: WorkflowActionStep,
    timeoutMs: number,
    context: Parameters<ActionRegistry['executeAction']>[1]
  ) {
    return new Promise<Awaited<ReturnType<ActionRegistry['executeAction']>>>(
      (resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`Action "${step.type}" timed out after ${timeoutMs} ms`));
        }, timeoutMs);

        this.actionRegistry
          .executeAction(step, context)
          .then((res) => {
            clearTimeout(timer);
            resolve(res);
          })
          .catch((err) => {
            clearTimeout(timer);
            reject(err);
          });
      }
    );
  }

  private recordSkippedExecution(
    workflow: AutomationWorkflow,
    triggerSource: string,
    payload: Record<string, unknown>,
    reason: string
  ): AutomationExecutionRow {
    const execRow = this.storage.createExecutionRecord(
      workflow.id,
      workflow.name,
      triggerSource,
      payload
    );
    this.storage.finishExecutionRecord(execRow.id, 'skipped', 0, reason);
    this.notifyStateChanged();
    return this.storage.getAutomationExecutionById(execRow.id)!;
  }

  private notifyStateChanged(): void {
    if (this.onStateChanged) {
      this.onStateChanged();
    }
  }
}
