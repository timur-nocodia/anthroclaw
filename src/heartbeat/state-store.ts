import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { logger } from '../logger.js';

export interface HeartbeatDeliveryTarget {
  channel: 'telegram' | 'whatsapp';
  peer_id: string;
  account_id?: string;
  thread_id?: string;
  session_key?: string;
}

export interface HeartbeatTaskState {
  lastRunAt?: number;
  lastStatus?: 'ok' | 'skipped' | 'error';
  lastError?: string | null;
}

export interface HeartbeatAgentState {
  tasks: Record<string, HeartbeatTaskState>;
  lastHeartbeatAt?: number;
  lastTarget?: HeartbeatDeliveryTarget;
  lastDeliveredHash?: string;
}

export interface HeartbeatStateFile {
  version: 1;
  agents: Record<string, HeartbeatAgentState>;
}

export class HeartbeatStateStore {
  private state: HeartbeatStateFile = { version: 1, agents: {} };

  constructor(private readonly filePath: string) {
    this.load();
  }

  private load(): void {
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf-8')) as Partial<HeartbeatStateFile>;
      this.state = {
        version: 1,
        agents: parsed && typeof parsed.agents === 'object' && parsed.agents ? parsed.agents as Record<string, HeartbeatAgentState> : {},
      };
    } catch {
      this.state = { version: 1, agents: {} };
    }
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), 'utf-8');
    } catch (err) {
      logger.warn({ err, path: this.filePath }, 'Failed to save heartbeat state');
    }
  }

  getAgent(agentId: string): HeartbeatAgentState {
    return this.ensureAgent(agentId);
  }

  recordTarget(agentId: string, target: HeartbeatDeliveryTarget): void {
    this.ensureAgent(agentId).lastTarget = target;
    this.save();
  }

  getLastTarget(agentId: string): HeartbeatDeliveryTarget | undefined {
    return this.ensureAgent(agentId).lastTarget;
  }

  markTaskRun(agentId: string, taskName: string, status: 'ok' | 'skipped' | 'error', at = Date.now(), error?: string): void {
    const agent = this.ensureAgent(agentId);
    agent.tasks[taskName] = {
      lastRunAt: at,
      lastStatus: status,
      lastError: error ?? null,
    };
    agent.lastHeartbeatAt = at;
    this.save();
  }

  recordDelivery(agentId: string, text: string): void {
    this.ensureAgent(agentId).lastDeliveredHash = createHash('sha256').update(text).digest('hex');
    this.save();
  }

  getTaskLastRun(agentId: string, taskName: string): number | undefined {
    return this.ensureAgent(agentId).tasks[taskName]?.lastRunAt;
  }

  private ensureAgent(agentId: string): HeartbeatAgentState {
    this.state.agents[agentId] ??= { tasks: {} };
    this.state.agents[agentId].tasks ??= {};
    return this.state.agents[agentId];
  }
}

