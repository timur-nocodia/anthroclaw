import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import type { ConfigSection } from './writer.js';

export interface AuditEntry {
  callerAgent: string;
  callerSession?: string;
  targetAgent: string;
  section: ConfigSection;
  action: string;
  prev: unknown;
  new: unknown;
  source: 'chat' | 'ui' | 'system';
}

export interface PersistedAuditEntry extends AuditEntry {
  ts: string;
}

export interface ReadRecentOptions {
  limit?: number;
  section?: ConfigSection;
}

export interface ConfigAuditLog {
  append(entry: AuditEntry): Promise<void>;
  /**
   * Returns recent audit entries newest-first.
   *
   * Limitation: only reads the active log file. Entries that have been
   * rotated to `{agentId}.jsonl.<N>` are not visible. Callers requesting
   * `limit: N` may receive fewer than N entries even when N entries exist
   * in the rolled history. This is acceptable for v1; multi-file scan
   * will land if/when audit history viewer needs deeper retention.
   */
  readRecent(agentId: string, opts?: ReadRecentOptions): Promise<PersistedAuditEntry[]>;
}

export interface CreateConfigAuditLogOptions {
  auditDir: string;
  maxFileBytes?: number;
  maxFiles?: number;
  clock?: () => Date;
}

const DEFAULT_MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const DEFAULT_MAX_FILES = 5;

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function logPath(auditDir: string, agentId: string): string {
  return join(auditDir, `${agentId}.jsonl`);
}

function rolledFiles(auditDir: string, agentId: string): { name: string; n: number }[] {
  if (!existsSync(auditDir)) return [];
  const prefix = `${agentId}.jsonl.`;
  return readdirSync(auditDir)
    .filter((f) => f.startsWith(prefix))
    .map((name) => ({ name, n: Number.parseInt(name.slice(prefix.length), 10) }))
    .filter((e) => Number.isFinite(e.n))
    .sort((a, b) => a.n - b.n);
}

function rotateIfNeeded(
  auditDir: string,
  agentId: string,
  maxFileBytes: number,
  maxFiles: number,
): void {
  const path = logPath(auditDir, agentId);
  if (!existsSync(path)) return;
  const size = statSync(path).size;
  if (size < maxFileBytes) return;
  const existing = rolledFiles(auditDir, agentId);
  const nextN = existing.length === 0 ? 1 : existing[existing.length - 1].n + 1;
  renameSync(path, join(auditDir, `${agentId}.jsonl.${nextN}`));
  // Prune older rolled files beyond maxFiles. We count current (active) file
  // as "in budget" so total active+rolled stays under maxFiles.
  const updated = rolledFiles(auditDir, agentId);
  const allowedRolled = Math.max(0, maxFiles - 1);
  if (updated.length > allowedRolled) {
    const toDelete = updated.slice(0, updated.length - allowedRolled);
    for (const e of toDelete) {
      try {
        unlinkSync(join(auditDir, e.name));
      } catch {
        // best-effort
      }
    }
  }
}

function serialize(entry: PersistedAuditEntry): string {
  const out = {
    ts: entry.ts,
    caller_agent: entry.callerAgent,
    ...(entry.callerSession !== undefined ? { caller_session: entry.callerSession } : {}),
    target_agent: entry.targetAgent,
    section: entry.section,
    action: entry.action,
    prev: entry.prev,
    new: entry.new,
    source: entry.source,
  };
  return JSON.stringify(out);
}

const VALID_SECTIONS: ReadonlySet<string> = new Set([
  'notifications',
  'human_takeover',
  'operator_console',
]);

function deserialize(line: string): PersistedAuditEntry | null {
  try {
    const obj = JSON.parse(line) as Record<string, unknown>;
    if (typeof obj.ts !== 'string' || typeof obj.target_agent !== 'string') return null;
    // Validate section against the canonical set rather than trusting a
    // possibly-tampered or corrupt persisted value.
    if (typeof obj.section !== 'string' || !VALID_SECTIONS.has(obj.section)) return null;
    return {
      ts: obj.ts,
      callerAgent: String(obj.caller_agent ?? ''),
      callerSession: typeof obj.caller_session === 'string' ? obj.caller_session : undefined,
      targetAgent: obj.target_agent,
      section: obj.section as ConfigSection,
      action: String(obj.action ?? ''),
      prev: obj.prev,
      new: obj.new,
      source: (obj.source as PersistedAuditEntry['source']) ?? 'system',
    };
  } catch {
    return null;
  }
}

export function createConfigAuditLog(opts: CreateConfigAuditLogOptions): ConfigAuditLog {
  const {
    auditDir,
    maxFileBytes = DEFAULT_MAX_FILE_BYTES,
    maxFiles = DEFAULT_MAX_FILES,
    clock = () => new Date(),
  } = opts;

  async function append(entry: AuditEntry): Promise<void> {
    ensureDir(auditDir);
    rotateIfNeeded(auditDir, entry.targetAgent, maxFileBytes, maxFiles);
    const persisted: PersistedAuditEntry = { ...entry, ts: clock().toISOString() };
    appendFileSync(logPath(auditDir, entry.targetAgent), `${serialize(persisted)}\n`, 'utf-8');
  }

  async function readRecent(
    agentId: string,
    options: ReadRecentOptions = {},
  ): Promise<PersistedAuditEntry[]> {
    const { limit = 50, section } = options;
    const path = logPath(auditDir, agentId);
    if (!existsSync(path)) return [];
    const raw = readFileSync(path, 'utf-8');
    const lines = raw.split('\n').filter((l) => l.length > 0);
    const entries: PersistedAuditEntry[] = [];
    for (const line of lines) {
      const e = deserialize(line);
      if (!e) continue;
      if (section && e.section !== section) continue;
      entries.push(e);
    }
    entries.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
    return entries.slice(0, limit);
  }

  return { append, readRecent };
}
