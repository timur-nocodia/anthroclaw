import { readFileSync, writeFileSync, existsSync, copyFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parse, parseDocument } from 'yaml';
import type { AgentYml } from '../src/config/schema.js';
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

export function inferProfile(cfg: Partial<AgentYml> & Record<string, unknown>): InferResult {
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
  const results: MigrationResult[] = [];
  let applied = 0;

  if (!existsSync(opts.agentsDir)) {
    return {
      summary: { scanned: 0, readyToApply: 0, needsReview: 0, applied: 0 },
      results: [],
    };
  }

  const entries = readdirSync(opts.agentsDir);

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

// CLI entrypoint
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const apply = process.argv.includes('--apply');
  const dirIdx = process.argv.indexOf('--dir');
  const agentsDir = dirIdx > 0 ? process.argv[dirIdx + 1] : 'agents';

  const out = await runMigration({ agentsDir, apply });

  console.log(`\nScanning ${agentsDir}/...\n`);
  for (const r of out.results) {
    console.log(`[${r.agentId}] ${r.error ? `❌ ${r.error}` : `inferred: ${r.profile} (${r.reason})`}`);
    if (r.toolConflicts.length > 0) {
      console.log(`  ⚠ tool conflicts: ${r.toolConflicts.join(', ')}`);
      console.log(`    ${apply ? 'Added' : 'Would add'} safety_overrides.allow_tools (review needed!)`);
    }
    if (r.hardBlacklistConflicts.length > 0) {
      console.log(`  ❗ HARD_BLACKLIST: ${r.hardBlacklistConflicts.join(', ')}`);
      console.log(`    Cannot be auto-migrated. Manually decide: remove or change safety_profile.`);
    }
    if (r.applied) console.log(`  ✅ applied`);
    console.log('');
  }

  console.log(`Summary:`);
  console.log(`  ${out.summary.scanned} agents scanned`);
  console.log(`  ${out.summary.readyToApply} ready to apply${apply ? '' : ' (--apply)'}`);
  console.log(`  ${out.summary.needsReview} need manual review`);
  if (apply) console.log(`  ${out.summary.applied} applied`);
  if (!apply && out.summary.readyToApply > 0) {
    console.log(`\nNo changes written. Re-run with --apply to commit.`);
  }
}
