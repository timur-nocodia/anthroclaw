import {
  copyFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { parseDocument } from 'yaml';
import { AgentYmlSchema } from './schema.js';
import type { ConfigAuditLog } from './audit.js';
import { logger } from '../logger.js';

export type ConfigSection = 'notifications' | 'human_takeover' | 'operator_console' | 'routes';

export interface PatchContext {
  caller?: string;
  callerSession?: string;
  source?: 'chat' | 'ui' | 'system';
  action?: string;
}

export interface ConfigWriteResult {
  agentId: string;
  section: ConfigSection;
  prevValue: unknown;
  newValue: unknown;
  writtenAt: string;
  backupPath: string;
}

export interface AgentConfigWriter {
  patchSection(
    agentId: string,
    section: ConfigSection,
    patch: (current: unknown) => unknown | null,
    context?: PatchContext,
  ): Promise<ConfigWriteResult>;
  readSection(agentId: string, section: ConfigSection): unknown;
  readFullConfig(agentId: string): unknown;
}

export interface CreateAgentConfigWriterOptions {
  agentsDir: string;
  backupKeep?: number;
  /**
   * Optional clock injection for deterministic backup timestamps in tests.
   * Returns epoch milliseconds (compatible with `Date.now()`). When omitted,
   * `Date.now()` is used.
   */
  clock?: () => number;
  auditLog?: ConfigAuditLog;
}

export class AgentConfigNotFoundError extends Error {
  constructor(agentId: string) {
    super(`agent.yml not found for agent "${agentId}"`);
    this.name = 'AgentConfigNotFoundError';
  }
}

export class ConfigValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>,
  ) {
    super(message);
    this.name = 'ConfigValidationError';
  }
}

const BACKUP_PREFIX = 'agent.yml.bak-';

function agentYmlPath(agentsDir: string, agentId: string): string {
  return join(agentsDir, agentId, 'agent.yml');
}

function timestampForBackup(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

function listBackups(agentsDir: string, agentId: string): string[] {
  const dir = join(agentsDir, agentId);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.startsWith(BACKUP_PREFIX))
    .sort();
}

function pruneBackups(agentsDir: string, agentId: string, keep: number): void {
  const backups = listBackups(agentsDir, agentId);
  if (backups.length <= keep) return;
  const toDelete = backups.slice(0, backups.length - keep);
  for (const name of toDelete) {
    try {
      unlinkSync(join(agentsDir, agentId, name));
    } catch {
      // best-effort prune; ignore
    }
  }
}

export function createAgentConfigWriter(opts: CreateAgentConfigWriterOptions): AgentConfigWriter {
  const { agentsDir, backupKeep = 10, auditLog, clock } = opts;
  const now = (): Date => new Date(clock?.() ?? Date.now());
  const locks = new Map<string, Promise<void>>();
  let backupSeq = 0;

  function readDoc(agentId: string) {
    const path = agentYmlPath(agentsDir, agentId);
    if (!existsSync(path)) throw new AgentConfigNotFoundError(agentId);
    const raw = readFileSync(path, 'utf-8');
    return { path, raw, doc: parseDocument(raw, { keepSourceTokens: true }) };
  }

  async function patchSection(
    agentId: string,
    section: ConfigSection,
    patch: (current: unknown) => unknown | null,
    context: PatchContext = {},
  ): Promise<ConfigWriteResult> {
    const prior = locks.get(agentId) ?? Promise.resolve();
    const run = prior
      .catch(() => undefined)
      .then(async () => {
        // doPatch is synchronous and the YAML file is on disk by the time
        // it returns. Audit logging is observability — failure must not
        // veto a committed write or the UI/caller will retry, producing a
        // redundant write + extra backup.
        const result = doPatch(agentId, section, patch);
        if (auditLog) {
          await auditLog
            .append({
              callerAgent: context.caller ?? 'system',
              callerSession: context.callerSession,
              targetAgent: agentId,
              section,
              action: context.action ?? 'patch_section',
              prev: result.prevValue ?? null,
              new: result.newValue,
              source: context.source ?? 'system',
            })
            .catch((err) => {
              logger.warn(
                { err, agentId, section },
                'audit log append failed; write was committed',
              );
            });
        }
        return result;
      });
    const lockPromise = run.then(
      () => undefined,
      () => undefined,
    );
    locks.set(agentId, lockPromise);
    // After this lock chain settles, evict the entry only if it's still
    // the same promise — a fresh write enqueued in the meantime will have
    // replaced it, and we must not delete the new chain. Without this GC
    // a long-running gateway with hot-reloaded agents accumulates entries.
    lockPromise.then(() => {
      if (locks.get(agentId) === lockPromise) {
        locks.delete(agentId);
      }
    });
    return run;
  }

  function doPatch(
    agentId: string,
    section: ConfigSection,
    patch: (current: unknown) => unknown | null,
  ): ConfigWriteResult {
    const { path, doc } = readDoc(agentId);
    const prevNode = doc.get(section);
    const prevValue =
      prevNode === undefined
        ? undefined
        : typeof (prevNode as { toJSON?: () => unknown }).toJSON === 'function'
          ? (prevNode as { toJSON: () => unknown }).toJSON()
          : prevNode;

    const newValue = patch(prevValue);
    if (newValue === null) {
      doc.delete(section);
    } else {
      doc.set(section, newValue);
    }

    const candidate = doc.toJS();
    const validation = AgentYmlSchema.safeParse(candidate);
    if (!validation.success) {
      const issues = validation.error.issues.map((i) => ({
        path: i.path,
        message: i.message,
      }));
      const summary = issues
        .map((i) => `${i.path.map((p) => String(p)).join('.')}: ${i.message}`)
        .join('; ');
      throw new ConfigValidationError(summary, issues);
    }

    const serialized = doc.toString();
    const writtenAt = now();
    const seq = (backupSeq++ % 1_000_000).toString().padStart(6, '0');
    const backupName = `${BACKUP_PREFIX}${timestampForBackup(writtenAt)}-${seq}`;
    const backupPath = join(agentsDir, agentId, backupName);
    copyFileSync(path, backupPath);

    const tmpPath = `${path}.tmp`;
    writeFileSync(tmpPath, serialized, 'utf-8');
    renameSync(tmpPath, path);

    pruneBackups(agentsDir, agentId, backupKeep);

    return {
      agentId,
      section,
      prevValue,
      newValue,
      writtenAt: writtenAt.toISOString(),
      backupPath,
    };
  }

  function readSection(agentId: string, section: ConfigSection): unknown {
    const { doc } = readDoc(agentId);
    const node = doc.get(section);
    if (node === undefined) return undefined;
    if (typeof (node as { toJSON?: () => unknown }).toJSON === 'function') {
      return (node as { toJSON: () => unknown }).toJSON();
    }
    return node;
  }

  function readFullConfig(agentId: string): unknown {
    const { doc } = readDoc(agentId);
    return doc.toJS();
  }

  return { patchSection, readSection, readFullConfig };
}
