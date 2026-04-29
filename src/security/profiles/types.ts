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
  permissionFlow: PermissionFlow;
  sandboxDefaults: SandboxDefaults;
  rateLimitFloor: RateLimitFloor | null;
  validateAllowlist(allowlist: AllowlistConfig | undefined): AllowlistValidation;
}
