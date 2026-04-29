import type { ProfileName, ToolMeta } from '../types.js';
import type { AllowlistConfig } from '../../config/schema.js';

export type SystemPromptSpec =
  | { mode: 'string'; text: string }
  | { mode: 'preset'; preset: 'claude_code'; excludeDynamicSections: boolean };

export type SettingSource = 'project' | 'user';

export type PermissionFlow = 'auto-allow' | 'auto-deny' | 'interactive' | 'strict-deny';

export interface SandboxDefaults {
  allowUnsandboxedCommands: boolean;
  enabled?: boolean;
}

export interface RateLimitFloor {
  windowMs: number;
  max: number;
}

export interface AllowlistValidation {
  ok: boolean;
  warnings: string[];
  error?: string;
}

export interface SafetyProfile {
  name: ProfileName;
  systemPrompt: SystemPromptSpec;
  settingSources: SettingSource[];
  builtinTools: {
    allowed: Set<string>;
    forbidden: Set<string>;
    requiresApproval: Set<string>;
  };
  mcpToolPolicy: {
    allowedByMeta: (meta: ToolMeta) => boolean;
    requiresApproval: (meta: ToolMeta) => boolean;
  };
  hardBlacklist: Set<string>;
  /**
   * If true, plugin-registered MCP tools (mcp__*-prefixed without explicit META)
   * are auto-allowed under this profile. Set false for public to avoid leaking
   * arbitrary plugin tools to anonymous users; trusted/private trust the host.
   */
  allowsPluginTools: boolean;
  permissionFlow: PermissionFlow;
  sandboxDefaults: SandboxDefaults;
  rateLimitFloor: RateLimitFloor | null;
  validateAllowlist(allowlist: AllowlistConfig | undefined): AllowlistValidation;
}
