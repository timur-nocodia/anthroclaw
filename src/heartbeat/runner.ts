import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Agent } from '../agent/agent.js';
import type { AgentYml } from '../config/schema.js';
import { logger } from '../logger.js';
import { DEFAULT_HEARTBEAT_EVERY, DEFAULT_HEARTBEAT_PROMPT, HEARTBEAT_ACK_TOKEN, HEARTBEAT_FILENAME } from './constants.js';
import { parseHeartbeatDurationMs } from './duration.js';
import { isHeartbeatContentEffectivelyEmpty, parseHeartbeatFile, type HeartbeatTask } from './parser.js';
import { isHeartbeatAckResponse } from './delivery-contract.js';
import type { HeartbeatDeliveryTarget, HeartbeatStateStore } from './state-store.js';
import { type HeartbeatHistoryStore, responseHash } from './history.js';
import { runHeartbeatTaskScript, type HeartbeatScriptResult } from './script.js';

export interface HeartbeatRunRequest {
  agent: Agent;
  sessionKey: string;
  prompt: string;
  target?: HeartbeatDeliveryTarget;
  ackToken: string;
  showOk: boolean;
  runId: string;
  taskNames: string[];
}

export interface HeartbeatRunResult {
  response: string | null;
  delivered: boolean;
}

export interface HeartbeatRunOutcome {
  agentId: string;
  status:
    | 'completed'
    | 'skipped'
    | 'busy'
    | 'disabled'
    | 'missing_file'
    | 'empty'
    | 'no_due_tasks'
    | 'no_target'
    | 'not_found'
    | 'error';
  runId?: string;
  startedAt?: number;
  taskNames?: string[];
  message?: string;
}

export interface HeartbeatRunnerDeps {
  listAgents: () => Agent[];
  stateStore: HeartbeatStateStore;
  isSessionActive: (sessionKey: string) => boolean;
  runHeartbeat: (request: HeartbeatRunRequest) => Promise<HeartbeatRunResult>;
  historyStore?: HeartbeatHistoryStore;
  nowMs?: () => number;
  retryMs?: number;
}

type AgentScheduleState = {
  nextDueAt: number;
  intervalMs: number;
};

type RunnableHeartbeatTask = HeartbeatTask & {
  scriptResult?: HeartbeatScriptResult;
};

export class HeartbeatRunner {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;
  private schedules = new Map<string, AgentScheduleState>();
  private running = new Set<string>();

  constructor(private readonly deps: HeartbeatRunnerDeps) {}

  start(): void {
    this.stopped = false;
    this.recomputeSchedules();
    this.scheduleNext();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.schedules.clear();
    this.running.clear();
  }

  reload(): void {
    if (this.stopped) return;
    this.recomputeSchedules();
    this.scheduleNext();
  }

  async runDue(reason: 'interval' | 'manual' | 'retry' = 'interval'): Promise<void> {
    if (this.stopped) return;
    const now = this.now();
    for (const agent of this.deps.listAgents()) {
      const schedule = this.schedules.get(agent.id);
      if (!schedule) continue;
      if (reason !== 'manual' && schedule.nextDueAt > now) continue;
      await this.runAgent(agent, reason);
    }
    this.scheduleNext();
  }

  async runNow(agentId: string): Promise<HeartbeatRunOutcome> {
    const agent = this.deps.listAgents().find((candidate) => candidate.id === agentId);
    if (!agent) return { agentId, status: 'not_found', message: `Agent "${agentId}" not found` };
    return this.runAgent(agent, 'manual', { forceDue: true });
  }

  private async runAgent(agent: Agent, reason: string, opts: { forceDue?: boolean } = {}): Promise<HeartbeatRunOutcome> {
    if (this.running.has(agent.id)) return { agentId: agent.id, status: 'busy', message: 'Heartbeat is already running for this agent' };
    const config = agent.config.heartbeat;
    if (!isHeartbeatEnabled(config)) return { agentId: agent.id, status: 'disabled', message: 'Heartbeat is disabled for this agent' };

    const startedAt = this.now();
    const sessionKey = heartbeatSessionKey(agent.id, config, startedAt);
    if (this.deps.isSessionActive(sessionKey)) {
      this.scheduleRetry();
      return { agentId: agent.id, status: 'busy', startedAt, message: 'Heartbeat session is active' };
    }

    const intervalMs = resolveHeartbeatEveryMs(config) ?? parseHeartbeatDurationMs(DEFAULT_HEARTBEAT_EVERY)!;
    const runId = `heartbeat-${agent.id}-${startedAt}`;
    this.running.add(agent.id);
    try {
      const filePath = join(agent.workspacePath, HEARTBEAT_FILENAME);
      if (!existsSync(filePath)) {
        this.advance(agent.id, startedAt + intervalMs);
        return { agentId: agent.id, status: 'missing_file', startedAt, message: `${HEARTBEAT_FILENAME} is missing` };
      }
      const content = readFileSync(filePath, 'utf-8');
      const parsed = parseHeartbeatFile(content);
      if (parsed.tasks.length === 0 && isHeartbeatContentEffectivelyEmpty(content)) {
        this.advance(agent.id, startedAt + intervalMs);
        return { agentId: agent.id, status: 'empty', startedAt, message: `${HEARTBEAT_FILENAME} is effectively empty` };
      }

      const dueTasks = opts.forceDue
        ? parsed.tasks
        : parsed.tasks.filter((task) => isTaskDue(
          this.deps.stateStore.getTaskLastRun(agent.id, task.name),
          task.interval,
          startedAt,
        ));
      if (dueTasks.length === 0) {
        this.advance(agent.id, startedAt + intervalMs);
        return { agentId: agent.id, status: 'no_due_tasks', startedAt, message: 'No heartbeat tasks are due' };
      }

      const target = config?.target === 'none' ? undefined : this.deps.stateStore.getLastTarget(agent.id);
      if ((config?.target ?? 'last') === 'last' && !target) {
        logger.info({ agentId: agent.id }, 'Heartbeat skipped: no last delivery target');
        this.advance(agent.id, startedAt + intervalMs);
        return { agentId: agent.id, status: 'no_target', startedAt, taskNames: dueTasks.map((task) => task.name), message: 'No last delivery target recorded' };
      }

      const runnableTasks: RunnableHeartbeatTask[] = [];
      for (const task of dueTasks) {
        const scriptResult = task.script
          ? await runHeartbeatTaskScript({
            workspacePath: agent.workspacePath,
            script: task.script,
            timeoutMs: task.timeout_ms,
          })
          : undefined;

        if (scriptResult?.wakeAgent === false) {
          this.deps.stateStore.markTaskRun(agent.id, task.name, 'skipped', startedAt);
          this.deps.historyStore?.appendRun({
            timestamp: startedAt,
            runId,
            agentId: agent.id,
            taskName: task.name,
            status: 'skipped_wake_gate',
            script: formatScriptLog(scriptResult),
            deliveryTarget: target,
          });
          continue;
        }
        runnableTasks.push({
          ...task,
          ...(scriptResult ? { scriptResult } : {}),
        });
      }
      if (runnableTasks.length === 0) {
        this.advance(agent.id, startedAt + intervalMs);
        return { agentId: agent.id, status: 'skipped', runId, startedAt, taskNames: dueTasks.map((task) => task.name), message: 'All due tasks were skipped by wake gates' };
      }

      const prompt = buildHeartbeatPrompt({
        basePrompt: config?.prompt ?? DEFAULT_HEARTBEAT_PROMPT,
        context: parsed.context,
        tasks: runnableTasks,
        reason,
      });

      const result = await this.deps.runHeartbeat({
        agent,
        sessionKey,
        prompt,
        target,
        ackToken: config?.ack_token ?? HEARTBEAT_ACK_TOKEN,
        showOk: config?.show_ok ?? false,
        runId,
        taskNames: runnableTasks.map((task) => task.name),
      });

      const ackToken = config?.ack_token ?? HEARTBEAT_ACK_TOKEN;
      const hasRealResponse = Boolean(result.response && ((config?.show_ok ?? false) || !isHeartbeatAckResponse(result.response, ackToken)));
      const status = hasRealResponse
        ? 'ok'
        : 'skipped';
      for (const task of runnableTasks) {
        const outputPath = hasRealResponse && result.response
          ? this.deps.historyStore?.writeOutput({
            agentId: agent.id,
            taskName: task.name,
            runId,
            content: result.response,
          })
          : undefined;
        this.deps.stateStore.markTaskRun(agent.id, task.name, status, startedAt);
        this.deps.historyStore?.appendRun({
          timestamp: startedAt,
          runId,
          agentId: agent.id,
          taskName: task.name,
          status: hasRealResponse ? (result.delivered ? 'delivered' : 'completed') : 'skipped_ack',
          delivered: result.delivered,
          ...(outputPath ? { outputPath } : {}),
          ...(result.response ? { responseHash: responseHash(result.response) } : {}),
          ...(task.scriptResult ? { script: formatScriptLog(task.scriptResult) } : {}),
          deliveryTarget: target,
        });
      }
      if (result.response && result.delivered) {
        this.deps.stateStore.recordDelivery(agent.id, result.response);
      }
      this.advance(agent.id, startedAt + intervalMs);
      return {
        agentId: agent.id,
        status: status === 'ok' ? 'completed' : 'skipped',
        runId,
        startedAt,
        taskNames: runnableTasks.map((task) => task.name),
      };
    } catch (err) {
      logger.error({ err, agentId: agent.id }, 'Heartbeat run failed');
      this.advance(agent.id, startedAt + intervalMs);
      return {
        agentId: agent.id,
        status: 'error',
        runId,
        startedAt,
        message: err instanceof Error ? err.message : String(err),
      };
    } finally {
      this.running.delete(agent.id);
    }
  }

  private recomputeSchedules(): void {
    const now = this.now();
    const next = new Map<string, AgentScheduleState>();
    for (const agent of this.deps.listAgents()) {
      const intervalMs = resolveHeartbeatEveryMs(agent.config.heartbeat);
      if (!intervalMs || !isHeartbeatEnabled(agent.config.heartbeat)) continue;
      const previous = this.schedules.get(agent.id);
      next.set(agent.id, {
        intervalMs,
        nextDueAt: previous?.nextDueAt && previous.intervalMs === intervalMs
          ? previous.nextDueAt
          : now + intervalMs,
      });
    }
    this.schedules = next;
  }

  private scheduleNext(): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    const nextDueAt = Math.min(...[...this.schedules.values()].map((entry) => entry.nextDueAt));
    if (!Number.isFinite(nextDueAt)) return;
    const delay = Math.max(0, nextDueAt - this.now());
    this.timer = setTimeout(() => void this.runDue('interval'), delay);
    this.timer.unref?.();
  }

  private scheduleRetry(): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.runDue('retry'), this.deps.retryMs ?? 1000);
    this.timer.unref?.();
  }

  private advance(agentId: string, nextDueAt: number): void {
    const entry = this.schedules.get(agentId);
    if (!entry) return;
    entry.nextDueAt = nextDueAt;
  }

  private now(): number {
    return this.deps.nowMs?.() ?? Date.now();
  }
}

export function resolveHeartbeatEveryMs(config: AgentYml['heartbeat']): number | null {
  if (!isHeartbeatEnabled(config)) return null;
  return parseHeartbeatDurationMs(config?.every ?? DEFAULT_HEARTBEAT_EVERY, { defaultUnit: 'm' });
}

function isHeartbeatEnabled(config: AgentYml['heartbeat']): boolean {
  return config?.enabled === true;
}

function isTaskDue(lastRunAt: number | undefined, interval: string, now: number): boolean {
  if (lastRunAt === undefined) return true;
  const intervalMs = parseHeartbeatDurationMs(interval, { defaultUnit: 'm' });
  if (!intervalMs) return false;
  return now - lastRunAt >= intervalMs;
}

function heartbeatSessionKey(agentId: string, config: AgentYml['heartbeat'], startedAt: number): string {
  return config?.isolated_session === false ? `${agentId}:heartbeat` : `${agentId}:heartbeat:${startedAt}`;
}

function buildHeartbeatPrompt(params: {
  basePrompt: string;
  context: string;
  tasks: RunnableHeartbeatTask[];
  reason: string;
}): string {
  const taskLines = params.tasks.map((task) => formatTaskForPrompt(task)).join('\n');
  return [
    params.basePrompt,
    '',
    `Heartbeat reason: ${params.reason}`,
    '',
    'Due tasks:',
    taskLines,
    params.context ? `\nAdditional HEARTBEAT.md context:\n${params.context}` : '',
  ].filter(Boolean).join('\n');
}

function formatTaskForPrompt(task: RunnableHeartbeatTask): string {
  const lines = [`- ${task.name} (${task.interval}): ${task.prompt}`];
  if (task.skills && task.skills.length > 0) {
    lines.push(`  Skills: ${task.skills.join(', ')}`);
  }
  if (task.scriptResult) {
    lines.push(`  Script: ${task.scriptResult.command}`);
    lines.push(`  Script exitCode: ${task.scriptResult.exitCode}${task.scriptResult.timedOut ? ' (timed out)' : ''}`);
    if (task.scriptResult.stdout.trim()) {
      lines.push(`  Script stdout:\n${indentBlock(task.scriptResult.stdout.trim(), '    ')}`);
    }
    if (task.scriptResult.stderr.trim()) {
      lines.push(`  Script stderr:\n${indentBlock(task.scriptResult.stderr.trim(), '    ')}`);
    }
    if (task.scriptResult.error) {
      lines.push(`  Script error: ${task.scriptResult.error}`);
    }
  }
  return lines.join('\n');
}

function indentBlock(value: string, prefix: string): string {
  return value.split('\n').map((line) => `${prefix}${line}`).join('\n');
}

function formatScriptLog(result: HeartbeatScriptResult): {
  command: string;
  exitCode: number | null;
  timedOut: boolean;
  wakeAgent?: boolean;
  error?: string;
} {
  return {
    command: result.command,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    ...(result.wakeAgent !== undefined ? { wakeAgent: result.wakeAgent } : {}),
    ...(result.error ? { error: result.error } : {}),
  };
}
