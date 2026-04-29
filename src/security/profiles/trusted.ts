import type { SafetyProfile } from './types.js';
import { BUILTIN_META } from '../builtin-tool-meta.js';

const allowed = new Set<string>();
const forbidden = new Set<string>();
const requiresApproval = new Set<string>();

for (const [name, meta] of Object.entries(BUILTIN_META)) {
  if (!meta.safe_in_trusted) {
    forbidden.add(name);
    continue;
  }
  allowed.add(name);
  if (meta.destructive) requiresApproval.add(name);
}

const hardBlacklist = new Set<string>(['manage_skills', 'access_control']);
for (const [name, meta] of Object.entries(BUILTIN_META)) {
  if (meta.hard_blacklist_in.includes('trusted')) hardBlacklist.add(name);
}

export const trustedProfile: SafetyProfile = {
  name: 'trusted',
  systemPrompt: { mode: 'preset', preset: 'claude_code', excludeDynamicSections: true },
  settingSources: ['project'],
  builtinTools: { allowed, forbidden, requiresApproval },
  mcpToolPolicy: {
    allowedByMeta: (meta) => meta.safe_in_trusted,
    requiresApproval: (meta) => meta.safe_in_trusted && meta.destructive,
  },
  hardBlacklist,
  allowsPluginTools: true,
  permissionFlow: 'interactive',
  sandboxDefaults: { allowUnsandboxedCommands: false, enabled: true },
  rateLimitFloor: { windowMs: 3_600_000, max: 100 },
  validateAllowlist: (allowlist) => {
    if (!allowlist) return { ok: true, warnings: [] };
    for (const channel of ['telegram', 'whatsapp'] as const) {
      const list = allowlist[channel] ?? [];
      if (list.includes('*')) {
        return {
          ok: false,
          warnings: [],
          error: `safety_profile=trusted does not allow wildcard "*" in allowlist.${channel}; use specific peer_ids or change profile to public.`,
        };
      }
    }
    return { ok: true, warnings: [] };
  },
};
