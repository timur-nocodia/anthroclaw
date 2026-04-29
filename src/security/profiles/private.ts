import type { SafetyProfile } from './types.js';
import { BUILTIN_META } from '../builtin-tool-meta.js';

const allowed = new Set<string>(Object.keys(BUILTIN_META));
const forbidden = new Set<string>();
const requiresApproval = new Set<string>();

for (const [name, meta] of Object.entries(BUILTIN_META)) {
  if (meta.destructive) requiresApproval.add(name);
}

export const privateProfile: SafetyProfile = {
  name: 'private',
  systemPrompt: { mode: 'preset', preset: 'claude_code', excludeDynamicSections: false },
  settingSources: ['project', 'user'],
  builtinTools: { allowed, forbidden, requiresApproval },
  mcpToolPolicy: {
    allowedByMeta: (meta) => meta.safe_in_private,
    requiresApproval: (meta) => meta.destructive,
  },
  hardBlacklist: new Set(),
  permissionFlow: 'interactive',
  sandboxDefaults: { allowUnsandboxedCommands: false, enabled: true },
  rateLimitFloor: null,
  validateAllowlist: (allowlist) => {
    if (!allowlist) {
      return { ok: false, warnings: [], error: 'safety_profile=private requires allowlist with exactly 1 peer per channel' };
    }
    let totalPeers = 0;
    for (const channel of ['telegram', 'whatsapp'] as const) {
      const list = allowlist[channel] ?? [];
      if (list.length === 0) continue;
      if (list.includes('*')) {
        return { ok: false, warnings: [], error: `safety_profile=private does not allow "*" in allowlist.${channel}` };
      }
      if (list.length !== 1) {
        return { ok: false, warnings: [], error: `safety_profile=private requires exactly 1 peer in allowlist.${channel}, got ${list.length}` };
      }
      totalPeers += 1;
    }
    if (totalPeers === 0) {
      return { ok: false, warnings: [], error: 'safety_profile=private requires at least one channel with exactly 1 peer' };
    }
    return { ok: true, warnings: [] };
  },
};
