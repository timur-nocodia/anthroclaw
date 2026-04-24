import { randomUUID } from 'node:crypto';

export type SubagentRunStatus = 'running' | 'completed';

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
    };

    this.runs.set(run.runId, run);
    const key = activeKey(run.agentId, run.parentSessionId, run.subagentId);
    const stack = this.activeRuns.get(key) ?? [];
    stack.push(run.runId);
    this.activeRuns.set(key, stack);

    return { ...run, parentSessionKeys: [...run.parentSessionKeys] };
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
      return { ...run, parentSessionKeys: [...run.parentSessionKeys] };
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
    };
    this.runs.set(synthetic.runId, synthetic);
    return { ...synthetic, parentSessionKeys: [...synthetic.parentSessionKeys] };
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
    return sliced.map((run) => ({ ...run, parentSessionKeys: [...run.parentSessionKeys] }));
  }

  getRun(agentId: string, runId: string): SubagentRunRecord | undefined {
    const run = this.runs.get(runId);
    if (!run || run.agentId !== agentId) return undefined;
    return { ...run, parentSessionKeys: [...run.parentSessionKeys] };
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
}
