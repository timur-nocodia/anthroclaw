import { describe, it, expect } from 'vitest';
import { HARNESS_BLOCKLIST } from '../src/security/harness-blocklist.js';
import { publicProfile, trustedProfile, privateProfile } from '../src/security/profiles/index.js';
import { ApprovalBroker } from '../src/security/approval-broker.js';
import { createCanUseTool } from '../src/sdk/permissions.js';

describe('HARNESS_BLOCKLIST', () => {
  it('blocks RemoteTrigger and CronCreate (harness cron primitives)', () => {
    expect(HARNESS_BLOCKLIST).toContain('RemoteTrigger');
    expect(HARNESS_BLOCKLIST).toContain('CronCreate');
  });
  it('blocks TodoWrite (harness todos, replaced by memory_write)', () => {
    expect(HARNESS_BLOCKLIST).toContain('TodoWrite');
  });
  it('blocks plan/worktree/notification primitives', () => {
    expect(HARNESS_BLOCKLIST).toContain('EnterPlanMode');
    expect(HARNESS_BLOCKLIST).toContain('AskUserQuestion');
    expect(HARNESS_BLOCKLIST).toContain('PushNotification');
  });
});

function fakeAgent(profile: any, mcp_tools: string[] = [], overrides: any = {}) {
  return {
    id: 'a',
    config: { safety_profile: profile.name, mcp_tools, safety_overrides: overrides, sdk: {} },
    safetyProfile: profile,
    workspacePath: '/tmp',
  } as any;
}

const stubOptions = { signal: new AbortController().signal, toolUseID: 'test' } as any;

describe('plugin tool auto-allow', () => {
  it('trusted: mcp__example-tools__lcm_grep (no META) → allow', async () => {
    const can = createCanUseTool({
      agent: fakeAgent(trustedProfile),
      approvalBroker: new ApprovalBroker(),
      channel: undefined,
      sessionContext: { peerId: '1', senderId: '1' },
    });
    const r = await can('mcp__example-tools__lcm_grep', { query: 'foo' }, stubOptions);
    expect(r.behavior).toBe('allow');
  });

  it('private: mcp__example-tools__lcm_status (no META) → allow', async () => {
    const can = createCanUseTool({
      agent: fakeAgent(privateProfile),
      approvalBroker: new ApprovalBroker(),
      channel: undefined,
      sessionContext: { peerId: '1', senderId: '1' },
    });
    const r = await can('mcp__example-tools__lcm_status', {}, stubOptions);
    expect(r.behavior).toBe('allow');
  });

  it('public: mcp__example-tools__lcm_grep (no META) → deny (no plugin auto-allow)', async () => {
    const can = createCanUseTool({
      agent: fakeAgent(publicProfile),
      approvalBroker: new ApprovalBroker(),
      channel: undefined,
      sessionContext: { peerId: '1', senderId: '1' },
    });
    const r = await can('mcp__example-tools__lcm_grep', { query: 'foo' }, stubOptions);
    expect(r.behavior).toBe('deny');
  });

  it('public: explicit override → allow plugin tool', async () => {
    const can = createCanUseTool({
      agent: fakeAgent(publicProfile, [], { allow_tools: ['lcm_grep'] }),
      approvalBroker: new ApprovalBroker(),
      channel: undefined,
      sessionContext: { peerId: '1', senderId: '1' },
    });
    const r = await can('mcp__example-tools__lcm_grep', { query: 'foo' }, stubOptions);
    expect(r.behavior).toBe('allow');
  });
});
