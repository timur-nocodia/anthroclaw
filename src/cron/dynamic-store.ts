import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { logger } from '../logger.js';

export interface DynamicCronJob {
  id: string;
  agentId: string;
  schedule: string;
  prompt: string;
  deliverTo: { channel: string; peer_id: string; account_id?: string; thread_id?: string };
  createdBy: { channel: string; sender_id: string; peer_id: string; account_id?: string; thread_id?: string };
  runOnce: boolean;
  durable: boolean;
  expiresAt: number | null;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export type DynamicCronJobInput = Omit<DynamicCronJob, 'createdAt' | 'updatedAt' | 'durable' | 'expiresAt' | 'runOnce'> & {
  runOnce?: boolean;
  durable?: boolean;
  expiresAt?: number | null;
};

export class DynamicCronStore {
  private jobs: DynamicCronJob[] = [];
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.load();
  }

  private load(): void {
    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        this.jobs = [];
        return;
      }
      const normalized = parsed
        .map((entry) => normalizeDynamicCronJob(entry))
        .filter((entry): entry is DynamicCronJob => Boolean(entry));
      this.jobs = normalized;
      if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
        this.save();
      }
    } catch {
      this.jobs = [];
    }
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(this.jobs, null, 2), 'utf-8');
    } catch (err) {
      logger.warn({ err, path: this.filePath }, 'Failed to save dynamic cron jobs');
    }
  }

  list(agentId: string): DynamicCronJob[] {
    return this.jobs.filter((j) => j.agentId === agentId);
  }

  create(job: DynamicCronJobInput): DynamicCronJob {
    const existing = this.jobs.find((j) => j.id === job.id && j.agentId === job.agentId);
    if (existing) {
      throw new Error(`Cron job with id "${job.id}" already exists for agent "${job.agentId}"`);
    }
    const now = Date.now();
    const full: DynamicCronJob = {
      ...job,
      runOnce: job.runOnce ?? false,
      durable: job.durable ?? true,
      expiresAt: job.expiresAt ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.jobs.push(full);
    this.save();
    return full;
  }

  delete(agentId: string, jobId: string): boolean {
    const idx = this.jobs.findIndex((j) => j.id === jobId && j.agentId === agentId);
    if (idx === -1) return false;
    this.jobs.splice(idx, 1);
    this.save();
    return true;
  }

  toggle(agentId: string, jobId: string, enabled: boolean): boolean {
    const job = this.jobs.find((j) => j.id === jobId && j.agentId === agentId);
    if (!job) return false;
    job.enabled = enabled;
    job.updatedAt = Date.now();
    this.save();
    return true;
  }

  getAll(): DynamicCronJob[] {
    return [...this.jobs];
  }
}

function normalizeDynamicCronJob(raw: unknown): DynamicCronJob | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;
  const id = stringValue(source.id);
  const agentId = stringValue(source.agentId);
  const schedule = stringValue(source.schedule);
  const prompt = stringValue(source.prompt);
  const deliverTo = normalizeDelivery(source.deliverTo);
  if (!id || !agentId || !schedule || !prompt || !deliverTo) return null;

  const createdBy = normalizeCreatedBy(source.createdBy, deliverTo);
  const createdAt = numberValue(source.createdAt) ?? Date.now();
  const updatedAt = numberValue(source.updatedAt) ?? createdAt;
  return {
    id,
    agentId,
    schedule,
    prompt,
    deliverTo,
    createdBy,
    runOnce: booleanValue(source.runOnce) ?? false,
    durable: booleanValue(source.durable) ?? true,
    expiresAt: numberValue(source.expiresAt),
    enabled: booleanValue(source.enabled) ?? true,
    createdAt,
    updatedAt,
  };
}

function normalizeDelivery(raw: unknown): DynamicCronJob['deliverTo'] | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;
  const channel = stringValue(source.channel);
  const peerId = stringValue(source.peer_id);
  if (!channel || !peerId) return null;
  const accountId = stringValue(source.account_id);
  const threadId = stringValue(source.thread_id);
  return {
    channel,
    peer_id: peerId,
    ...(accountId ? { account_id: accountId } : {}),
    ...(threadId ? { thread_id: threadId } : {}),
  };
}

function normalizeCreatedBy(raw: unknown, deliverTo: DynamicCronJob['deliverTo']): DynamicCronJob['createdBy'] {
  if (!raw || typeof raw !== 'object') {
    return {
      channel: deliverTo.channel,
      sender_id: deliverTo.peer_id,
      peer_id: deliverTo.peer_id,
      ...(deliverTo.account_id ? { account_id: deliverTo.account_id } : {}),
      ...(deliverTo.thread_id ? { thread_id: deliverTo.thread_id } : {}),
    };
  }
  const source = raw as Record<string, unknown>;
  const accountId = stringValue(source.account_id) ?? deliverTo.account_id;
  const threadId = stringValue(source.thread_id) ?? deliverTo.thread_id;
  return {
    channel: stringValue(source.channel) ?? deliverTo.channel,
    sender_id: stringValue(source.sender_id) ?? deliverTo.peer_id,
    peer_id: stringValue(source.peer_id) ?? deliverTo.peer_id,
    ...(accountId ? { account_id: accountId } : {}),
    ...(threadId ? { thread_id: threadId } : {}),
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}
