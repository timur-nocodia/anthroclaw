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
