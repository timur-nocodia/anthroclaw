import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSdkOptions } from '../options.js';
import { publicProfile, trustedProfile, privateProfile } from '../../security/profiles/index.js';
import { ApprovalBroker } from '../../security/approval-broker.js';

function fakeAgent(profile: any, sdkConfig?: any, workspacePath?: string) {
  return {
    id: 'a',
    config: { safety_profile: profile.name, model: 'claude-sonnet-4-6', sdk: sdkConfig ?? {}, mcp_tools: [] },
    safetyProfile: profile,
    // Default to an isolated tmpdir without CLAUDE.md so the legacy assertions
    // (e.g. "public uses string system prompt") still see the bare profile text.
    workspacePath: workspacePath ?? mkdtempSync(join(tmpdir(), 'options-profile-empty-')),
    tools: [],
    mcpServer: { name: 'a-tools', instance: {} } as any,
  } as any;
}

describe('buildSdkOptions profile-aware', () => {
  it('public uses string system prompt', () => {
    const opts = buildSdkOptions({
      agent: fakeAgent(publicProfile),
      approvalBroker: new ApprovalBroker(),
      sessionContext: { peerId: '1' },
    });
    expect(typeof opts.systemPrompt).toBe('string');
    expect(opts.systemPrompt as string).toMatch(/public-facing/i);
  });

  it('public uses empty settingSources', () => {
    const opts = buildSdkOptions({
      agent: fakeAgent(publicProfile),
      approvalBroker: new ApprovalBroker(),
      sessionContext: { peerId: '1' },
    });
    expect(opts.settingSources).toEqual([]);
  });

  it('trusted uses preset claude_code; capability cutoff forces settingSources to []', () => {
    const opts = buildSdkOptions({
      agent: fakeAgent(trustedProfile),
      approvalBroker: new ApprovalBroker(),
      sessionContext: { peerId: '1' },
    });
    expect((opts.systemPrompt as any).type).toBe('preset');
    expect((opts.systemPrompt as any).preset).toBe('claude_code');
    // Profile declares ['project'] but applyCutoffOptions overrides — cutoff is ground truth.
    expect(opts.settingSources).toEqual([]);
  });

  it('private uses preset; capability cutoff forces settingSources to []', () => {
    const opts = buildSdkOptions({
      agent: fakeAgent(privateProfile),
      approvalBroker: new ApprovalBroker(),
      sessionContext: { peerId: '1' },
    });
    // Profile declares ['project', 'user'] but applyCutoffOptions overrides — cutoff is ground truth.
    expect(opts.settingSources).toEqual([]);
  });
});

describe('buildSdkOptions sandboxDefaults from profile', () => {
  it('public profile without agent sdk.sandbox → allowUnsandboxedCommands=false from profile', () => {
    const opts = buildSdkOptions({
      agent: fakeAgent(publicProfile),
      approvalBroker: new ApprovalBroker(),
      sessionContext: { peerId: '1' },
    });
    expect((opts.sandbox as any)?.allowUnsandboxedCommands).toBe(false);
  });

  it('trusted profile without agent sdk.sandbox → allowUnsandboxedCommands=false from profile', () => {
    const opts = buildSdkOptions({
      agent: fakeAgent(trustedProfile),
      approvalBroker: new ApprovalBroker(),
      sessionContext: { peerId: '1' },
    });
    expect((opts.sandbox as any)?.allowUnsandboxedCommands).toBe(false);
  });

  it('private profile + agent sdk.sandbox.allowUnsandboxedCommands=true → agent override wins', () => {
    const opts = buildSdkOptions({
      agent: fakeAgent(privateProfile, { sandbox: { allowUnsandboxedCommands: true } }),
      approvalBroker: new ApprovalBroker(),
      sessionContext: { peerId: '1' },
    });
    expect((opts.sandbox as any)?.allowUnsandboxedCommands).toBe(true);
  });

  it('public profile + agent sdk.sandbox.allowUnsandboxedCommands=true → agent override wins', () => {
    const opts = buildSdkOptions({
      agent: fakeAgent(publicProfile, { sandbox: { allowUnsandboxedCommands: true } }),
      approvalBroker: new ApprovalBroker(),
      sessionContext: { peerId: '1' },
    });
    expect((opts.sandbox as any)?.allowUnsandboxedCommands).toBe(true);
  });
});

// v0.9 system-prompt resolution — under v0.8 the public/trusted/private
// profiles ignored the agent's CLAUDE.md and shipped only the profile baseline.
// These tests pin the new behaviour: CLAUDE.md is concatenated for string-mode
// profiles (public) and threaded through `append` for preset-mode profiles
// (trusted, private). Spec:
// docs/superpowers/specs/2026-05-05-system-prompt-resolution-design.md
describe('buildSdkOptions includes agent CLAUDE.md across profiles (v0.9 #72)', () => {
  let workspaceWith: string;
  let workspaceWithout: string;
  const claudeMdBody = '# Test Agent\n\nThis agent has authored guidance.';

  beforeEach(() => {
    workspaceWith = mkdtempSync(join(tmpdir(), 'options-profile-with-claudemd-'));
    workspaceWithout = mkdtempSync(join(tmpdir(), 'options-profile-no-claudemd-'));
    writeFileSync(join(workspaceWith, 'CLAUDE.md'), claudeMdBody, 'utf-8');
  });

  afterEach(() => {
    rmSync(workspaceWith, { recursive: true, force: true });
    rmSync(workspaceWithout, { recursive: true, force: true });
  });

  it('public profile includes agent CLAUDE.md alongside profile text', () => {
    const opts = buildSdkOptions({
      agent: fakeAgent(publicProfile, undefined, workspaceWith),
      approvalBroker: new ApprovalBroker(),
      sessionContext: { peerId: '1' },
    });
    expect(typeof opts.systemPrompt).toBe('string');
    const sp = opts.systemPrompt as string;
    // Profile baseline still present.
    expect(sp).toMatch(/public-facing/i);
    // CLAUDE.md content concatenated.
    expect(sp).toContain('# Test Agent');
    expect(sp).toContain('This agent has authored guidance.');
  });

  it('trusted profile uses preset with append=CLAUDE.md', () => {
    const opts = buildSdkOptions({
      agent: fakeAgent(trustedProfile, undefined, workspaceWith),
      approvalBroker: new ApprovalBroker(),
      sessionContext: { peerId: '1' },
    });
    const sp = opts.systemPrompt as any;
    expect(sp.type).toBe('preset');
    expect(sp.preset).toBe('claude_code');
    expect(typeof sp.append).toBe('string');
    expect(sp.append).toContain('# Test Agent');
    expect(sp.append).toContain('This agent has authored guidance.');
  });

  it('private profile uses preset with append=CLAUDE.md', () => {
    const opts = buildSdkOptions({
      agent: fakeAgent(privateProfile, undefined, workspaceWith),
      approvalBroker: new ApprovalBroker(),
      sessionContext: { peerId: '1' },
    });
    const sp = opts.systemPrompt as any;
    expect(sp.type).toBe('preset');
    expect(sp.preset).toBe('claude_code');
    expect(typeof sp.append).toBe('string');
    expect(sp.append).toContain('# Test Agent');
    expect(sp.append).toContain('This agent has authored guidance.');
  });

  it('trusted profile preset has no append when no CLAUDE.md exists', () => {
    const opts = buildSdkOptions({
      agent: fakeAgent(trustedProfile, undefined, workspaceWithout),
      approvalBroker: new ApprovalBroker(),
      sessionContext: { peerId: '1' },
    });
    const sp = opts.systemPrompt as any;
    expect(sp.type).toBe('preset');
    expect(sp.preset).toBe('claude_code');
    expect(sp.append).toBeUndefined();
  });
});
