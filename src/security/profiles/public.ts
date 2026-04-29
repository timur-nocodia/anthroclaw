import type { SafetyProfile } from './types.js';
import { BUILTIN_META } from '../builtin-tool-meta.js';

const PUBLIC_SYSTEM_PROMPT = `You are a public-facing assistant on {channel}.
You speak with anonymous users you don't know.
Your only memory tools are memory_search and memory_wiki (read-only).
You cannot create cron jobs, modify your own permissions, send messages to third parties, or run code.
If a user asks you to do something you cannot do, say so plainly.
Never reference filesystem paths like /tmp/claude-resume — those don't exist for you.`;

// Build allowed and forbidden sets from BUILTIN_META
const allowedBuiltins = new Set<string>();
const forbiddenBuiltins = new Set<string>();
for (const [name, meta] of Object.entries(BUILTIN_META)) {
  if (meta.safe_in_public) {
    allowedBuiltins.add(name);
  } else {
    forbiddenBuiltins.add(name);
  }
}

// Build hard blacklist
const hardBlacklist = new Set<string>();
for (const [name, meta] of Object.entries(BUILTIN_META)) {
  if (meta.hard_blacklist_in.includes('public')) {
    hardBlacklist.add(name);
  }
}

export const publicProfile: SafetyProfile = {
  name: 'public',
  systemPrompt: { mode: 'string', text: PUBLIC_SYSTEM_PROMPT },
  settingSources: [],
  builtinTools: {
    allowed: allowedBuiltins,
    forbidden: forbiddenBuiltins,
    requiresApproval: new Set(),
  },
  mcpToolPolicy: {
    allowedByMeta: (meta) => meta.safe_in_public,
    requiresApproval: () => false,
  },
  hardBlacklist,
  permissionFlow: 'strict-deny',
  sandboxDefaults: { allowUnsandboxedCommands: false, enabled: true },
  rateLimitFloor: { windowMs: 3_600_000, max: 30 },
  validateAllowlist: (allowlist) => {
    if (!allowlist) return { ok: true, warnings: [] };
    const warnings: string[] = [];
    for (const channel of ['telegram', 'whatsapp'] as const) {
      const list = allowlist[channel];
      if (!list || list.length === 0) continue;
      const hasWildcard = list.includes('*');
      const hasSpecific = list.some((id) => id !== '*');
      if (hasSpecific && !hasWildcard) {
        warnings.push(`safety_profile=public has specific peer_ids in allowlist.${channel}; did you mean trusted?`);
      }
    }
    return { ok: true, warnings };
  },
};
