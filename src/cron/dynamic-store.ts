import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { logger } from '../logger.js';

export interface DynamicCronJob {
  id: string;
  agentId: string;
  schedule: string;
  prompt: string;
  deliverTo?: { channel: string; peer_id: string; account_id?: string };
  enabled: boolean;
  createdAt: number;
}

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
      this.jobs = JSON.parse(raw);
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

  create(job: Omit<DynamicCronJob, 'createdAt'>): DynamicCronJob {
    const existing = this.jobs.find((j) => j.id === job.id && j.agentId === job.agentId);
    if (existing) {
      throw new Error(`Cron job with id "${job.id}" already exists for agent "${job.agentId}"`);
    }
    const full: DynamicCronJob = { ...job, createdAt: Date.now() };
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
    this.save();
    return true;
  }

  getAll(): DynamicCronJob[] {
    return [...this.jobs];
  }
}
