import { isAbsolute, resolve } from 'node:path';
import {
  FileOwnershipRegistry,
  type FileOwnershipClaim,
  type FileOwnershipConflict,
  type FileOwnershipConflictMode,
} from './file-ownership.js';

export interface FileOwnershipToolUseContext {
  sessionKey: string;
  runId: string;
  subagentId: string;
  toolName: string;
  toolInput: unknown;
  cwd?: string;
  conflictMode?: FileOwnershipConflictMode;
}

export interface FileOwnershipToolUseDecision {
  applies: boolean;
  allowed: boolean;
  message?: string;
  path?: string;
  claim?: FileOwnershipClaim;
  conflicts: FileOwnershipConflict[];
}

const WRITE_PATH_KEYS_BY_TOOL: Record<string, string[]> = {
  Write: ['file_path', 'path'],
  Edit: ['file_path', 'path'],
  MultiEdit: ['file_path', 'path'],
  NotebookEdit: ['notebook_path', 'file_path', 'path'],
};

export function evaluateFileOwnershipToolUse(
  registry: FileOwnershipRegistry,
  context: FileOwnershipToolUseContext,
  now = Date.now(),
): FileOwnershipToolUseDecision {
  const path = extractWritePath(context.toolName, context.toolInput, context.cwd);
  if (!path) {
    return { applies: false, allowed: true, conflicts: [] };
  }

  const decision = registry.claim({
    sessionKey: context.sessionKey,
    runId: context.runId,
    subagentId: context.subagentId,
    path,
    mode: 'write',
  }, context.conflictMode ?? 'soft', now);

  if (!decision.allowed) {
    return {
      applies: true,
      allowed: false,
      path,
      conflicts: decision.conflicts,
      message: formatOwnershipMessage('deny', decision.conflicts),
    };
  }

  return {
    applies: true,
    allowed: true,
    path,
    claim: decision.claim,
    conflicts: decision.conflicts,
    message: decision.conflicts.length > 0
      ? formatOwnershipMessage('allow', decision.conflicts)
      : undefined,
  };
}

export function extractWritePath(toolName: string, toolInput: unknown, cwd?: string): string | undefined {
  const keys = WRITE_PATH_KEYS_BY_TOOL[toolName];
  if (!keys) return undefined;

  const input = toRecord(toolInput);
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return absolutizePath(value, cwd);
    }
  }

  return undefined;
}

function absolutizePath(path: string, cwd?: string): string {
  if (!cwd || isAbsolute(path)) return path;
  return resolve(cwd, path);
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function formatOwnershipMessage(action: 'allow' | 'deny', conflicts: FileOwnershipConflict[]): string {
  const conflict = conflicts[0];
  if (!conflict) {
    return action === 'deny'
      ? 'File ownership denied this write.'
      : 'File ownership allowed this write.';
  }

  const owner = `${conflict.existing.subagentId}/${conflict.existing.runId}`;
  const requester = `${conflict.requested.subagentId}/${conflict.requested.runId}`;
  return action === 'deny'
    ? `File ownership denied ${requester} writing ${conflict.path}; currently owned by ${owner}.`
    : `File ownership conflict recorded for ${requester} writing ${conflict.path}; currently owned by ${owner}.`;
}
