import { randomUUID } from 'node:crypto';

export type SubagentRunStatus = 'running' | 'completed';
export type SubagentToolEventStatus = 'started' | 'completed' | 'failed';

export interface SubagentToolCount {
  started: number;
  completed: number;
  failed: number;
}

export interface SubagentToolSummary {
  started: number;
  completed: number;
  failed: number;
  toolNames: string[];
  byTool: Record<string, SubagentToolCount>;
  lastToolName?: string;
  lastStatus?: SubagentToolEventStatus;
  lastAt?: number;
}

export interface SubagentRunRecord {
  runId: string;
  agentId: string;
  parentSessionId: string;
  parentSessionKeys: string[];
  subagentId: string;
  subagentType?: string;
  status: SubagentRunStatus;
  startedAt: number;
  finishedAt?: number;
  cwd?: string;
  permissionMode?: string;
  parentTranscriptPath?: string;
  subagentTranscriptPath?: string;
  lastAssistantMessage?: string;
  toolSummary: SubagentToolSummary;
}

export interface SubagentRunEvent {
  agentId: string;
  parentSessionId: string;
  parentSessionKeys?: string[];
  subagentId: string;
  subagentType?: string;
  cwd?: string;
  permissionMode?: string;
  parentTranscriptPath?: string;
  subagentTranscriptPath?: string;
  lastAssistantMessage?: string;
}

export interface ListSubagentRunsParams {
  agentId?: string;
  parentSessionId?: string;
  status?: SubagentRunStatus;
  limit?: number;
  offset?: number;
}

export interface SubagentToolEvent {
  agentId: string;
  parentSessionId: string;
  subagentId: string;
  toolName: string;
  status: SubagentToolEventStatus;
}

function activeKey(agentId: string, parentSessionId: string, subagentId: string): string {
  return `${agentId}\u0000${parentSessionId}\u0000${subagentId}`;
}

export class SdkSubagentRegistry {
  private runs = new Map<string, SubagentRunRecord>();
  private activeRuns = new Map<string, string[]>();

  recordStart(event: SubagentRunEvent, now = Date.now()): SubagentRunRecord {
    const run: SubagentRunRecord = {
      runId: randomUUID(),
      agentId: event.agentId,
      parentSessionId: event.parentSessionId,
      parentSessionKeys: [...(event.parentSessionKeys ?? [])],
      subagentId: event.subagentId,
      subagentType: event.subagentType,
      status: 'running',
      startedAt: now,
      cwd: event.cwd,
      permissionMode: event.permissionMode,
      parentTranscriptPath: event.parentTranscriptPath,
      toolSummary: emptyToolSummary(),
    };

    this.runs.set(run.runId, run);
    const key = activeKey(run.agentId, run.parentSessionId, run.subagentId);
    const stack = this.activeRuns.get(key) ?? [];
    stack.push(run.runId);
    this.activeRuns.set(key, stack);

    return this.cloneRun(run);
  }

  recordStop(event: SubagentRunEvent, now = Date.now()): SubagentRunRecord {
    const key = activeKey(event.agentId, event.parentSessionId, event.subagentId);
    const stack = this.activeRuns.get(key);
    const runId = stack?.pop();

    if (stack && stack.length > 0) {
      this.activeRuns.set(key, stack);
    } else {
      this.activeRuns.delete(key);
    }

    const run = runId ? this.runs.get(runId) : undefined;
    if (run) {
      run.status = 'completed';
      run.finishedAt = now;
      run.parentSessionKeys = [...(event.parentSessionKeys ?? run.parentSessionKeys)];
      run.subagentType = event.subagentType ?? run.subagentType;
      run.cwd = event.cwd ?? run.cwd;
      run.permissionMode = event.permissionMode ?? run.permissionMode;
      run.parentTranscriptPath = event.parentTranscriptPath ?? run.parentTranscriptPath;
      run.subagentTranscriptPath = event.subagentTranscriptPath ?? run.subagentTranscriptPath;
      run.lastAssistantMessage = event.lastAssistantMessage ?? run.lastAssistantMessage;
      return this.cloneRun(run);
    }

    const synthetic: SubagentRunRecord = {
      runId: randomUUID(),
      agentId: event.agentId,
      parentSessionId: event.parentSessionId,
      parentSessionKeys: [...(event.parentSessionKeys ?? [])],
      subagentId: event.subagentId,
      subagentType: event.subagentType,
      status: 'completed',
      startedAt: now,
      finishedAt: now,
      cwd: event.cwd,
      permissionMode: event.permissionMode,
      parentTranscriptPath: event.parentTranscriptPath,
      subagentTranscriptPath: event.subagentTranscriptPath,
      lastAssistantMessage: event.lastAssistantMessage,
      toolSummary: emptyToolSummary(),
    };
    this.runs.set(synthetic.runId, synthetic);
    return this.cloneRun(synthetic);
  }

  recordToolEvent(event: SubagentToolEvent, now = Date.now()): SubagentRunRecord | undefined {
    const stack = this.activeRuns.get(activeKey(event.agentId, event.parentSessionId, event.subagentId));
    const runId = stack?.at(-1);
    if (!runId) return undefined;

    const run = this.runs.get(runId);
    if (!run) return undefined;

    const toolName = event.toolName.trim();
    if (!toolName) return { ...run, parentSessionKeys: [...run.parentSessionKeys], toolSummary: cloneToolSummary(run.toolSummary) };

    const current = run.toolSummary.byTool[toolName] ?? { started: 0, completed: 0, failed: 0 };
    current[event.status] += 1;
    run.toolSummary.byTool[toolName] = current;
    run.toolSummary[event.status] += 1;
    run.toolSummary.toolNames = Object.keys(run.toolSummary.byTool).sort();
    run.toolSummary.lastToolName = toolName;
    run.toolSummary.lastStatus = event.status;
    run.toolSummary.lastAt = now;

    return { ...run, parentSessionKeys: [...run.parentSessionKeys], toolSummary: cloneToolSummary(run.toolSummary) };
  }

  listRuns(params: ListSubagentRunsParams = {}): SubagentRunRecord[] {
    const offset = Math.max(0, params.offset ?? 0);
    const limit = params.limit !== undefined ? Math.max(0, params.limit) : undefined;

    const rows = [...this.runs.values()]
      .filter((run) => {
        if (params.agentId && run.agentId !== params.agentId) return false;
        if (params.parentSessionId && run.parentSessionId !== params.parentSessionId) return false;
        if (params.status && run.status !== params.status) return false;
        return true;
      })
      .sort((a, b) => {
        if (b.startedAt !== a.startedAt) return b.startedAt - a.startedAt;
        return b.runId.localeCompare(a.runId);
      });

    const sliced = limit !== undefined ? rows.slice(offset, offset + limit) : rows.slice(offset);
    return sliced.map((run) => this.cloneRun(run));
  }

  getRun(agentId: string, runId: string): SubagentRunRecord | undefined {
    const run = this.runs.get(runId);
    if (!run || run.agentId !== agentId) return undefined;
    return this.cloneRun(run);
  }

  getActiveRun(
    agentId: string,
    parentSessionId: string,
    subagentId: string,
  ): SubagentRunRecord | undefined {
    const stack = this.activeRuns.get(activeKey(agentId, parentSessionId, subagentId));
    const runId = stack?.at(-1);
    if (!runId) return undefined;
    const run = this.runs.get(runId);
    return run ? this.cloneRun(run) : undefined;
  }

  deleteSession(agentId: string, parentSessionId: string): number {
    const runIds = [...this.runs.values()]
      .filter((run) => run.agentId === agentId && run.parentSessionId === parentSessionId)
      .map((run) => run.runId);

    for (const runId of runIds) {
      this.removeRun(runId);
    }

    return runIds.length;
  }

  clearAgent(agentId: string): number {
    const runIds = [...this.runs.values()]
      .filter((run) => run.agentId === agentId)
      .map((run) => run.runId);

    for (const runId of runIds) {
      this.removeRun(runId);
    }

    return runIds.length;
  }

  clear(): void {
    this.runs.clear();
    this.activeRuns.clear();
  }

  private removeRun(runId: string): void {
    const run = this.runs.get(runId);
    if (!run) return;

    this.runs.delete(runId);
    const key = activeKey(run.agentId, run.parentSessionId, run.subagentId);
    const stack = this.activeRuns.get(key);
    if (!stack) return;

    const next = stack.filter((id) => id !== runId);
    if (next.length === 0) {
      this.activeRuns.delete(key);
      return;
    }

    this.activeRuns.set(key, next);
  }

  private cloneRun(run: SubagentRunRecord): SubagentRunRecord {
    return {
      ...run,
      parentSessionKeys: [...run.parentSessionKeys],
      toolSummary: cloneToolSummary(run.toolSummary),
    };
  }
}

function emptyToolSummary(): SubagentToolSummary {
  return {
    started: 0,
    completed: 0,
    failed: 0,
    toolNames: [],
    byTool: {},
  };
}

function cloneToolSummary(summary: SubagentToolSummary): SubagentToolSummary {
  return {
    started: summary.started,
    completed: summary.completed,
    failed: summary.failed,
    toolNames: [...summary.toolNames],
    byTool: Object.fromEntries(
      Object.entries(summary.byTool).map(([toolName, count]) => [toolName, { ...count }]),
    ),
    lastToolName: summary.lastToolName,
    lastStatus: summary.lastStatus,
    lastAt: summary.lastAt,
  };
}
