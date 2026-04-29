import { describe, it, expect } from 'vitest';
import { buildSdkOptions } from '../options.js';
import { publicProfile, trustedProfile, privateProfile } from '../../security/profiles/index.js';
import { ApprovalBroker } from '../../security/approval-broker.js';

function fakeAgent(profile: any, sdkConfig?: any) {
  return {
    id: 'a',
    config: { safety_profile: profile.name, model: 'claude-sonnet-4-6', sdk: sdkConfig ?? {}, mcp_tools: [] },
    safetyProfile: profile,
    workspacePath: '/tmp',
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
    expect((opts.systemPrompt as any).type).toBe('string');
    expect((opts.systemPrompt as any).text).toMatch(/public-facing/i);
  });

  it('public uses empty settingSources', () => {
    const opts = buildSdkOptions({
      agent: fakeAgent(publicProfile),
      approvalBroker: new ApprovalBroker(),
      sessionContext: { peerId: '1' },
    });
    expect(opts.settingSources).toEqual([]);
  });

  it('trusted uses preset claude_code with project source', () => {
    const opts = buildSdkOptions({
      agent: fakeAgent(trustedProfile),
      approvalBroker: new ApprovalBroker(),
      sessionContext: { peerId: '1' },
    });
    expect((opts.systemPrompt as any).type).toBe('preset');
    expect((opts.systemPrompt as any).preset).toBe('claude_code');
    expect(opts.settingSources).toEqual(['project']);
  });

  it('private uses preset and full settingSources', () => {
    const opts = buildSdkOptions({
      agent: fakeAgent(privateProfile),
      approvalBroker: new ApprovalBroker(),
      sessionContext: { peerId: '1' },
    });
    expect(opts.settingSources).toEqual(['project', 'user']);
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
