import { describe, it, expect } from 'vitest';
import { chatLikeOpenclawProfile } from '../chat-like-openclaw.js';
import { BUILTIN_META } from '../../builtin-tool-meta.js';

describe('chatLikeOpenclawProfile', () => {
  it('name is "chat_like_openclaw"', () => {
    expect(chatLikeOpenclawProfile.name).toBe('chat_like_openclaw');
  });

  it('systemPrompt is in string mode (placeholder, resolved at runtime)', () => {
    expect(chatLikeOpenclawProfile.systemPrompt.mode).toBe('string');
  });

  it('settingSources is empty array', () => {
    expect(chatLikeOpenclawProfile.settingSources).toEqual([]);
  });

  it('builtinTools.allowed contains every built-in (Bash, Write, Edit, Read, etc.)', () => {
    const allBuiltins = Object.keys(BUILTIN_META);
    for (const name of allBuiltins) {
      expect(chatLikeOpenclawProfile.builtinTools.allowed.has(name)).toBe(true);
    }
  });

  it('builtinTools.requiresApproval is empty', () => {
    expect(chatLikeOpenclawProfile.builtinTools.requiresApproval.size).toBe(0);
  });

  it('builtinTools.forbidden is empty', () => {
    expect(chatLikeOpenclawProfile.builtinTools.forbidden.size).toBe(0);
  });

  it('mcpToolPolicy.allowedByMeta returns true for any meta', () => {
    expect(chatLikeOpenclawProfile.mcpToolPolicy.allowedByMeta({
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
    expect(chatLikeOpenclawProfile.mcpToolPolicy.requiresApproval({
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
    expect(chatLikeOpenclawProfile.hardBlacklist.size).toBe(0);
  });

  it('allowsPluginTools is true', () => {
    expect(chatLikeOpenclawProfile.allowsPluginTools).toBe(true);
  });

  it('permissionFlow is auto-allow', () => {
    expect(chatLikeOpenclawProfile.permissionFlow).toBe('auto-allow');
  });

  it('sandboxDefaults disables sandbox and allows unsandboxed commands', () => {
    expect(chatLikeOpenclawProfile.sandboxDefaults).toEqual({
      allowUnsandboxedCommands: true,
      enabled: false,
    });
  });

  it('rateLimitFloor is null', () => {
    expect(chatLikeOpenclawProfile.rateLimitFloor).toBeNull();
  });

  it('validateAllowlist accepts undefined allowlist', () => {
    expect(chatLikeOpenclawProfile.validateAllowlist(undefined)).toEqual({ ok: true, warnings: [] });
  });

  it('validateAllowlist accepts wildcard', () => {
    expect(chatLikeOpenclawProfile.validateAllowlist({ telegram: ['*'] })).toEqual({ ok: true, warnings: [] });
  });

  it('validateAllowlist accepts specific peers', () => {
    expect(chatLikeOpenclawProfile.validateAllowlist({ telegram: ['12345'] })).toEqual({ ok: true, warnings: [] });
  });

  it('validateAllowlist accepts mixed wildcard + specifics', () => {
    expect(
      chatLikeOpenclawProfile.validateAllowlist({ telegram: ['*', '12345'], whatsapp: ['*'] }),
    ).toEqual({ ok: true, warnings: [] });
  });
});
