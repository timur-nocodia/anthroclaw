import { readFileSync, writeFileSync, existsSync, copyFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parse, parseDocument } from 'yaml';
import { getProfile } from '../src/security/profiles/index.js';
import { BUILTIN_META } from '../src/security/builtin-tool-meta.js';
import { MCP_META } from '../src/security/mcp-meta-registry.js';

export interface InferResult {
  profile: 'public' | 'trusted' | 'private' | null;
  reason: string;
  toolConflicts: string[];
  hardBlacklistConflicts: string[];
  error?: string;
}

export function inferProfile(cfg: any): InferResult {
  const allowlist = cfg.allowlist ?? {};
  const pairing = cfg.pairing ?? {};
  const tools: string[] = cfg.mcp_tools ?? [];

  let profile: 'public' | 'trusted' | 'private' | null = null;
  let reason = '';

  const allLists = [allowlist.telegram, allowlist.whatsapp].filter((l): l is string[] => Array.isArray(l));
  const peerCounts = allLists.map((l) => l.filter((p) => p !== '*').length);
  const totalSpecific = peerCounts.reduce((s, n) => s + n, 0);
  const hasWildcard = allLists.some((l) => l.includes('*'));

  // Rule 1: exactly 1 peer per channel that has a list
  const channelsWithSpecific = peerCounts.filter((n) => n > 0);
  if (totalSpecific > 0 && channelsWithSpecific.every((n) => n === 1) && !hasWildcard) {
    profile = 'private';
    reason = 'allowlist has exactly 1 peer per channel';
  } else if (pairing.mode === 'open' || hasWildcard) {
    profile = 'public';
    reason = pairing.mode === 'open' ? 'pairing.mode=open' : 'allowlist contains "*"';
  } else if ((pairing.mode === 'approve' || pairing.mode === 'code') && totalSpecific > 0) {
    profile = 'trusted';
    reason = `pairing.mode=${pairing.mode} with specific peer_ids`;
  } else if (pairing.mode === 'off' && totalSpecific === 0) {
    return {
      profile: null,
      reason: '',
      toolConflicts: [],
      hardBlacklistConflicts: [],
      error: 'agent denies everyone (pairing.mode=off, no allowlist) — pick safety_profile manually',
    };
  } else {
    profile = 'trusted';
    reason = 'fallback (could not classify confidently)';
  }

  // Tool compatibility check
  const target = getProfile(profile);
  const toolConflicts: string[] = [];
  const hardBlacklistConflicts: string[] = [];

  for (const t of tools) {
    const meta = MCP_META[t] ?? BUILTIN_META[t];
    if (!meta) continue;
    if (meta.hard_blacklist_in.includes(profile)) {
      hardBlacklistConflicts.push(t);
      continue;
    }
    const allowedNatively =
      target.builtinTools.allowed.has(t) || target.mcpToolPolicy.allowedByMeta(meta);
    if (!allowedNatively) toolConflicts.push(t);
  }

  return { profile, reason, toolConflicts, hardBlacklistConflicts };
}

export interface MigrationResult {
  agentId: string;
  profile: 'public' | 'trusted' | 'private' | null;
  reason: string;
  toolConflicts: string[];
  hardBlacklistConflicts: string[];
  needsManualReview: boolean;
  applied: boolean;
  error?: string;
}

export interface MigrationOptions {
  agentsDir: string;
  apply: boolean;
}

export interface MigrationOutput {
  summary: { scanned: number; readyToApply: number; needsReview: number; applied: number };
  results: MigrationResult[];
}

export async function runMigration(opts: MigrationOptions): Promise<MigrationOutput> {
  const entries = readdirSync(opts.agentsDir);
  const results: MigrationResult[] = [];
  let applied = 0;

  for (const name of entries) {
    const dir = join(opts.agentsDir, name);
    if (!statSync(dir).isDirectory()) continue;
    const ymlPath = join(dir, 'agent.yml');
    if (!existsSync(ymlPath)) continue;

    const raw = readFileSync(ymlPath, 'utf-8');
    let cfg: any;
    try {
      cfg = parse(raw);
    } catch (err) {
      results.push({
        agentId: name,
        profile: null,
        reason: '',
        toolConflicts: [],
        hardBlacklistConflicts: [],
        needsManualReview: false,
        applied: false,
        error: `parse: ${(err as Error).message}`,
      });
      continue;
    }

    if (cfg?.safety_profile) {
      results.push({
        agentId: name,
        profile: cfg.safety_profile,
        reason: 'already set',
        toolConflicts: [],
        hardBlacklistConflicts: [],
        needsManualReview: false,
        applied: false,
      });
      continue;
    }

    const inferred = inferProfile(cfg);
    if (inferred.error) {
      results.push({
        agentId: name,
        profile: null,
        reason: '',
        toolConflicts: [],
        hardBlacklistConflicts: [],
        needsManualReview: true,
        applied: false,
        error: inferred.error,
      });
      continue;
    }

    const needsReview = inferred.hardBlacklistConflicts.length > 0;
    let didApply = false;
    if (opts.apply && !needsReview) {
      didApply = applyToFile(ymlPath, inferred);
      if (didApply) applied += 1;
    }
    results.push({
      agentId: name,
      profile: inferred.profile,
      reason: inferred.reason,
      toolConflicts: inferred.toolConflicts,
      hardBlacklistConflicts: inferred.hardBlacklistConflicts,
      needsManualReview: needsReview,
      applied: didApply,
    });
  }

  return {
    summary: {
      scanned: results.length,
      readyToApply: results.filter((r) => !r.needsManualReview && r.profile && !r.error).length,
      needsReview: results.filter((r) => r.needsManualReview).length,
      applied,
    },
    results,
  };
}

function applyToFile(path: string, inferred: InferResult): boolean {
  if (!inferred.profile) return false;

  const raw = readFileSync(path, 'utf-8');
  const doc = parseDocument(raw);

  // Backup
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const bakPath = `${path}.bak-${ts}`;
  copyFileSync(path, bakPath);

  // Add safety_profile
  doc.set('safety_profile', inferred.profile);

  // Add safety_overrides for tool conflicts (non-HARD_BLACKLIST)
  if (inferred.toolConflicts.length > 0) {
    const existing = doc.get('safety_overrides') as any;
    const allowList = (existing?.allow_tools ?? []) as string[];
    const merged = Array.from(new Set([...allowList, ...inferred.toolConflicts]));
    doc.set('safety_overrides', { allow_tools: merged });
  }

  writeFileSync(path, doc.toString(), 'utf-8');
  return true;
}
