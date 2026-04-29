import { describe, it, expect } from 'vitest';
import type { SafetyProfile } from '../types.js';

describe('SafetyProfile interface', () => {
  it('accepts a fully-formed profile object', () => {
    const p: SafetyProfile = {
      name: 'public',
      systemPrompt: { mode: 'string', text: 'You are a public assistant.' },
      settingSources: [],
      builtinTools: { allowed: new Set(['Read']), forbidden: new Set(['Bash']), requiresApproval: new Set() },
      mcpToolPolicy: {
        allowedByMeta: () => true,
        requiresApproval: () => false,
      },
      hardBlacklist: new Set(['Bash', 'access_control']),
      permissionFlow: 'strict-deny',
      sandboxDefaults: { allowUnsandboxedCommands: false },
      rateLimitFloor: { windowMs: 3_600_000, max: 30 },
      validateAllowlist: () => ({ ok: true, warnings: [] }),
    };
    expect(p.name).toBe('public');
    expect(p.permissionFlow).toBe('strict-deny');
  });
});
