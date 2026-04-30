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

  // personality field info-warning on non-chat profiles
  if (config.personality && config.safety_profile !== 'chat_like_openclaw') {
    warnings.push(
      `personality field is set but has no effect on safety_profile=${config.safety_profile} (only applies to chat_like_openclaw)`,
    );
  }

  // Check overrides
  const overrides = config.safety_overrides ?? {};
  const allowOverrides = new Set(overrides.allow_tools ?? []);

  // bypass: chat permits, private permits, others reject
  if (
    overrides.permission_mode === 'bypass' &&
    config.safety_profile !== 'private' &&
    config.safety_profile !== 'chat_like_openclaw'
  ) {
    return {
      ok: false,
      warnings: [],
      error: `safety_overrides.permission_mode=bypass is only allowed with safety_profile=private or chat_like_openclaw (got ${config.safety_profile})`,
    };
  }
  if (overrides.permission_mode === 'bypass' && config.safety_profile !== 'chat_like_openclaw') {
    // chat already runs without approval — no need to log "running without approval" warning twice.
    warnings.push('safety_overrides.permission_mode=bypass: all tools will run without approval');
  }

  if (config.heartbeat?.enabled === true && config.safety_profile === 'public') {
    if (!allowOverrides.has('heartbeat')) {
      return {
        ok: false,
        warnings: [],
        error:
          'heartbeat.enabled=true is not allowed with safety_profile=public unless explicitly opened via safety_overrides.allow_tools: ["heartbeat"]',
      };
    }
    warnings.push('safety_overrides.allow_tools opens "heartbeat" in safety_profile=public');
  }

  // chat profile: most overrides are no-op (everything is already allowed)
  if (config.safety_profile === 'chat_like_openclaw') {
    if (overrides.allow_tools && overrides.allow_tools.length > 0) {
      warnings.push(
        'safety_overrides.allow_tools have no effect on safety_profile=chat_like_openclaw — all tools are already allowed',
      );
    }
    // deny_tools and permission_mode=default DO have effect on chat — don't warn.
    return { ok: true, warnings };
  }

  // Existing tool-compat check (kept verbatim from current validator) for non-chat profiles
  const tools = config.mcp_tools ?? [];

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
        `   See docs/guide.md#safety-profiles`,
    };
  }

  return { ok: true, warnings };
}
