import type { SafetyProfile } from './types.js';
import { BUILTIN_META } from '../builtin-tool-meta.js';

const allowed = new Set<string>(Object.keys(BUILTIN_META));

/**
 * `chat_like_openclaw` — friendly conversational profile for personal/single-user
 * mode. Pure-string system prompt (no claude_code preset), all built-in and MCP
 * tools auto-allowed, no approval flow, wildcard allowlist permitted, no sandbox.
 *
 * The actual system prompt text is resolved at runtime in
 * `src/sdk/options.ts::buildSdkOptions` by combining the per-agent
 * `personality` field (or CHAT_PERSONALITY_BASELINE) with the agent's CLAUDE.md.
 * The `systemPrompt.text` here is a placeholder — never read directly when
 * profile.name === 'chat_like_openclaw'.
 */
export const chatLikeOpenclawProfile: SafetyProfile = {
  name: 'chat_like_openclaw',
  systemPrompt: { mode: 'string', text: '' },
  settingSources: [],
  builtinTools: {
    allowed,
    forbidden: new Set(),
    requiresApproval: new Set(),
  },
  mcpToolPolicy: {
    allowedByMeta: () => true,
    requiresApproval: () => false,
  },
  hardBlacklist: new Set(),
  allowsPluginTools: true,
  permissionFlow: 'auto-allow',
  sandboxDefaults: { allowUnsandboxedCommands: true, enabled: false },
  rateLimitFloor: null,
  validateAllowlist: () => ({ ok: true, warnings: [] }),
};
