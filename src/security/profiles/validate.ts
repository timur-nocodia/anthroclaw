import type { AgentYml } from '../../config/schema.js';
import { getProfile } from './index.js';
import { BUILTIN_META } from '../builtin-tool-meta.js';
import { MCP_META } from '../mcp-meta-registry.js';

export interface ValidationResult {
  ok: boolean;
  warnings: string[];
  error?: string;
}

function profilesAllowingTool(toolName: string): string[] {
  const meta = MCP_META[toolName] ?? BUILTIN_META[toolName];
  if (!meta) return [];
  const allowed: string[] = [];
  if (meta.safe_in_public) allowed.push('public');
  if (meta.safe_in_trusted) allowed.push('trusted');
  if (meta.safe_in_private) allowed.push('private');
  return allowed;
}

export function validateSafetyProfile(config: AgentYml): ValidationResult {
  const warnings: string[] = [];
  const profile = getProfile(config.safety_profile);

  // Check allowlist shape
  const allowlistResult = profile.validateAllowlist(config.allowlist);
  if (!allowlistResult.ok) {
    return { ok: false, warnings: [], error: allowlistResult.error ?? 'allowlist invalid' };
  }
  warnings.push(...allowlistResult.warnings);

  // Check overrides
  const overrides = config.safety_overrides ?? {};
  if (overrides.permission_mode === 'bypass' && config.safety_profile !== 'private') {
    return {
      ok: false,
      warnings: [],
      error: `safety_overrides.permission_mode=bypass is only allowed with safety_profile=private (got ${config.safety_profile})`,
    };
  }
  if (overrides.permission_mode === 'bypass') {
    warnings.push('safety_overrides.permission_mode=bypass: all tools will run without approval');
  }

  // Check mcp_tools compat
  const tools = config.mcp_tools ?? [];
  const allowOverrides = new Set(overrides.allow_tools ?? []);

  const incompatible: { name: string; reason: string }[] = [];
  for (const toolName of tools) {
    const meta = MCP_META[toolName] ?? BUILTIN_META[toolName];
    if (!meta) continue;
    if (meta.hard_blacklist_in.includes(profile.name)) {
      incompatible.push({
        name: toolName,
        reason: 'HARD_BLACKLIST — cannot be opened via override',
      });
      continue;
    }
    const allowedByProfile =
      profile.builtinTools.allowed.has(toolName) ||
      profile.mcpToolPolicy.allowedByMeta(meta);
    const allowedByOverride = allowOverrides.has(toolName);
    if (!allowedByProfile && !allowedByOverride) {
      incompatible.push({
        name: toolName,
        reason: `forbidden by safety_profile=${profile.name}`,
      });
    } else if (allowedByOverride && !allowedByProfile) {
      warnings.push(`safety_overrides.allow_tools opens "${toolName}" in safety_profile=${profile.name}`);
    }
  }

  if (incompatible.length > 0) {
    const lines = incompatible.map((i) => {
      const allowedIn = profilesAllowingTool(i.name).join(', ') || 'none';
      const toolMeta = MCP_META[i.name] ?? BUILTIN_META[i.name];
      const blacklist = toolMeta?.hard_blacklist_in ?? [];
      const blacklistNote = blacklist.length > 0 ? `; HARD_BLACKLIST in ${blacklist.join(', ')}` : '';
      return `     - ${i.name}      (allowed in: ${allowedIn}${blacklistNote})`;
    });
    return {
      ok: false,
      warnings: [],
      error:
        `safety_profile "${profile.name}" forbids these tools listed in mcp_tools:\n` +
        lines.join('\n') +
        `\n\n   Options:\n` +
        `     1. Remove these tools from mcp_tools (safest)\n` +
        `     2. Change safety_profile to a more permissive one\n` +
        `     3. Add to safety_overrides.allow_tools (logged as WARN; HARD_BLACKLIST cannot be overridden)\n\n` +
        `   See docs/safety-profiles.md`,
    };
  }

  return { ok: true, warnings };
}
