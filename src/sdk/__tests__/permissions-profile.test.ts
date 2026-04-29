import { describe, it, expect, vi } from 'vitest';
import { createCanUseTool } from '../permissions.js';
import { publicProfile, trustedProfile, privateProfile } from '../../security/profiles/index.js';
import { ApprovalBroker } from '../../security/approval-broker.js';

function fakeAgent(profile: any, mcp_tools: string[] = [], overrides: any = {}) {
  return {
    id: 'a',
    config: { safety_profile: profile.name, mcp_tools, safety_overrides: overrides, sdk: {} },
    safetyProfile: profile,
    workspacePath: '/tmp',
  } as any;
}

describe('canUseTool profile gating', () => {
  it('public profile denies Bash with reason', async () => {
    const can = createCanUseTool({
      agent: fakeAgent(publicProfile),
      approvalBroker: new ApprovalBroker(),
      channel: undefined,
      sessionContext: { peerId: '1' },
    });
    const r = await can('Bash', { command: 'ls' });
    expect(r.behavior).toBe('deny');
  });

  it('public profile allows Read', async () => {
    const can = createCanUseTool({
      agent: fakeAgent(publicProfile),
      approvalBroker: new ApprovalBroker(),
      channel: undefined,
      sessionContext: { peerId: '1' },
    });
    const r = await can('Read', { file_path: '/tmp/foo' });
    expect(r.behavior).toBe('allow');
  });

  it('trusted: destructive Write requests approval via channel', async () => {
    const broker = new ApprovalBroker();
    const promptForApproval = vi.fn(async () => undefined);
    const channel = { supportsApproval: true, promptForApproval } as any;
    const can = createCanUseTool({
      agent: fakeAgent(trustedProfile),
      approvalBroker: broker,
      channel,
      sessionContext: { peerId: '1' },
    });
    const promise = can('Write', { file_path: '/tmp/x', content: 'y' });
    // Simulate user clicking allow
    setImmediate(() => {
      const callArgs = promptForApproval.mock.calls[0]?.[0];
      if (callArgs?.id) broker.resolve(callArgs.id, 'allow');
    });
    const r = await promise;
    expect(r.behavior).toBe('allow');
    expect(promptForApproval).toHaveBeenCalled();
  });

  it('trusted on WA (no approval channel): denies destructive', async () => {
    const channel = { supportsApproval: false, promptForApproval: vi.fn() } as any;
    const can = createCanUseTool({
      agent: fakeAgent(trustedProfile),
      approvalBroker: new ApprovalBroker(),
      channel,
      sessionContext: { peerId: '1' },
    });
    const r = await can('Write', { file_path: '/tmp/x', content: 'y' });
    expect(r.behavior).toBe('deny');
    expect((r as any).message).toMatch(/approval|channel/i);
  });

  it('private + bypass override: allows everything without approval', async () => {
    const channel = { supportsApproval: true, promptForApproval: vi.fn() } as any;
    const can = createCanUseTool({
      agent: fakeAgent(privateProfile, [], { permission_mode: 'bypass' }),
      approvalBroker: new ApprovalBroker(),
      channel,
      sessionContext: { peerId: '1' },
    });
    const r = await can('Bash', { command: 'ls' });
    expect(r.behavior).toBe('allow');
    expect(channel.promptForApproval).not.toHaveBeenCalled();
  });
});
