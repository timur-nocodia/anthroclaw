import { describe, it, expect } from 'vitest';
import { chatLikeAnthroclawProfile } from '../chat-like-anthroclaw.js';
import { BUILTIN_META } from '../../builtin-tool-meta.js';

describe('chatLikeAnthroclawProfile', () => {
  it('name is "chat_like_anthroclaw"', () => {
    expect(chatLikeAnthroclawProfile.name).toBe('chat_like_anthroclaw');
  });

  it('systemPrompt is in string mode (placeholder, resolved at runtime)', () => {
    expect(chatLikeAnthroclawProfile.systemPrompt.mode).toBe('string');
  });

  it('settingSources is empty array', () => {
    expect(chatLikeAnthroclawProfile.settingSources).toEqual([]);
  });

  it('builtinTools.allowed contains every built-in (Bash, Write, Edit, Read, etc.)', () => {
    const allBuiltins = Object.keys(BUILTIN_META);
    for (const name of allBuiltins) {
      expect(chatLikeAnthroclawProfile.builtinTools.allowed.has(name)).toBe(true);
    }
  });

  it('builtinTools.requiresApproval is empty', () => {
    expect(chatLikeAnthroclawProfile.builtinTools.requiresApproval.size).toBe(0);
  });

  it('builtinTools.forbidden is empty', () => {
    expect(chatLikeAnthroclawProfile.builtinTools.forbidden.size).toBe(0);
  });

  it('mcpToolPolicy.allowedByMeta returns true for any meta', () => {
    expect(chatLikeAnthroclawProfile.mcpToolPolicy.allowedByMeta({
      category: 'agent-config',
      safe_in_public: false,
      safe_in_trusted: false,
      safe_in_private: false,
      destructive: true,
      reads_only: false,
      hard_blacklist_in: [],
    })).toBe(true);
  });

  it('mcpToolPolicy.requiresApproval returns false for any meta', () => {
    expect(chatLikeAnthroclawProfile.mcpToolPolicy.requiresApproval({
      category: 'agent-config',
      safe_in_public: false,
      safe_in_trusted: false,
      safe_in_private: false,
      destructive: true,
      reads_only: false,
      hard_blacklist_in: [],
    })).toBe(false);
  });

  it('hardBlacklist is empty', () => {
    expect(chatLikeAnthroclawProfile.hardBlacklist.size).toBe(0);
  });

  it('allowsPluginTools is true', () => {
    expect(chatLikeAnthroclawProfile.allowsPluginTools).toBe(true);
  });

  it('permissionFlow is auto-allow', () => {
    expect(chatLikeAnthroclawProfile.permissionFlow).toBe('auto-allow');
  });

  it('sandboxDefaults disables sandbox and allows unsandboxed commands', () => {
    expect(chatLikeAnthroclawProfile.sandboxDefaults).toEqual({
      allowUnsandboxedCommands: true,
      enabled: false,
    });
  });

  it('rateLimitFloor is null', () => {
    expect(chatLikeAnthroclawProfile.rateLimitFloor).toBeNull();
  });

  it('validateAllowlist accepts undefined allowlist', () => {
    expect(chatLikeAnthroclawProfile.validateAllowlist(undefined)).toEqual({ ok: true, warnings: [] });
  });

  it('validateAllowlist accepts wildcard', () => {
    expect(chatLikeAnthroclawProfile.validateAllowlist({ telegram: ['*'] })).toEqual({ ok: true, warnings: [] });
  });

  it('validateAllowlist accepts specific peers', () => {
    expect(chatLikeAnthroclawProfile.validateAllowlist({ telegram: ['12345'] })).toEqual({ ok: true, warnings: [] });
  });

  it('validateAllowlist accepts mixed wildcard + specifics', () => {
    expect(
      chatLikeAnthroclawProfile.validateAllowlist({ telegram: ['*', '12345'], whatsapp: ['*'] }),
    ).toEqual({ ok: true, warnings: [] });
  });
});
