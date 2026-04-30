import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { HeartbeatDeliveryTarget } from './state-store.js';

export type HeartbeatRunLogStatus =
  | 'skipped_wake_gate'
  | 'skipped_ack'
  | 'completed'
  | 'delivered'
  | 'error';

export interface HeartbeatRunLogEntry {
  timestamp: number;
  runId: string;
  agentId: string;
  taskName: string;
  status: HeartbeatRunLogStatus;
  delivered?: boolean;
  outputPath?: string;
  responseHash?: string;
  script?: {
    command: string;
    exitCode: number | null;
    timedOut: boolean;
    wakeAgent?: boolean;
    error?: string;
  };
  deliveryTarget?: HeartbeatDeliveryTarget;
  error?: string;
}

export class HeartbeatHistoryStore {
  constructor(
    private readonly outputRoot: string,
    private readonly runLogPath: string,
  ) {}

  writeOutput(params: {
    agentId: string;
    taskName: string;
    runId: string;
    content: string;
  }): string {
    const safeAgentId = sanitizePathPart(params.agentId);
    const safeTaskName = sanitizePathPart(params.taskName);
    const safeRunId = sanitizePathPart(params.runId);
    const outputPath = join(this.outputRoot, safeAgentId, safeTaskName, `${safeRunId}.md`);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, params.content, 'utf-8');
    return outputPath;
  }

  appendRun(entry: HeartbeatRunLogEntry): void {
    mkdirSync(dirname(this.runLogPath), { recursive: true });
    appendFileSync(this.runLogPath, `${JSON.stringify(entry)}\n`, 'utf-8');
  }

  listRuns(limit = 100): HeartbeatRunLogEntry[] {
    if (!existsSync(this.runLogPath)) return [];
    const lines = readFileSync(this.runLogPath, 'utf-8').trim().split('\n').filter(Boolean);
    return lines.slice(-limit).map((line) => JSON.parse(line) as HeartbeatRunLogEntry);
  }

  readOutput(outputPath: string): string | null {
    const root = resolve(this.outputRoot);
    const target = resolve(outputPath);
    if (!isInside(root, target) || !existsSync(target)) return null;
    return readFileSync(target, 'utf-8');
  }
}

export function responseHash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function sanitizePathPart(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown';
}

function isInside(root: string, candidate: string): boolean {
  const normalizedRoot = root.endsWith('/') ? root : `${root}/`;
  return candidate === root || candidate.startsWith(normalizedRoot);
}
