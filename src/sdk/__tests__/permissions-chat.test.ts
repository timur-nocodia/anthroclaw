import { describe, it, expect } from 'vitest';
import { createCanUseTool } from '../permissions.js';
import { chatLikeOpenclawProfile } from '../../security/profiles/chat-like-openclaw.js';
import { ApprovalBroker } from '../../security/approval-broker.js';

function makeAgent(overrides?: Record<string, unknown>) {
  return {
    id: 'test-agent',
    safetyProfile: chatLikeOpenclawProfile,
    config: {
      safety_overrides: overrides ?? {},
      sdk: undefined,
    },
  } as any;
}

const ctx = { channel: 'telegram', peerId: 'peer-1', accountId: 'content_sm' };
const signal = new AbortController().signal;

describe('createCanUseTool on chat profile', () => {
  it('allows Bash without approval', async () => {
    const fn = createCanUseTool({ agent: makeAgent(), approvalBroker: new ApprovalBroker(), sessionContext: ctx });
    const result = await fn('Bash', { command: 'ls' }, { signal, toolUseID: 't1' });
    expect(result.behavior).toBe('allow');
  });

  it('allows MCP plugin tools (mcp__example-tools__lcm_grep) without approval', async () => {
    const fn = createCanUseTool({ agent: makeAgent(), approvalBroker: new ApprovalBroker(), sessionContext: ctx });
    const result = await fn('mcp__example-tools__lcm_grep', { q: 'test' }, { signal, toolUseID: 't2' });
    expect(result.behavior).toBe('allow');
  });

  it('allows MCP destructive tools (manage_cron, manage_skills, access_control) without approval', async () => {
    const fn = createCanUseTool({ agent: makeAgent(), approvalBroker: new ApprovalBroker(), sessionContext: ctx });
    for (const name of ['manage_cron', 'manage_skills', 'access_control']) {
      const result = await fn(`mcp__test__${name}`, {}, { signal, toolUseID: `t-${name}` });
      expect(result.behavior).toBe('allow');
    }
  });

  it('fills manage_cron create deliver_to from dispatch context', async () => {
    const fn = createCanUseTool({ agent: makeAgent(), approvalBroker: new ApprovalBroker(), sessionContext: ctx });
    const result = await fn(
      'mcp__test__manage_cron',
      { action: 'create', id: 'daily', schedule: '0 9 * * *', prompt: 'hello' },
      { signal, toolUseID: 't-cron-create' },
    );
    expect(result).toMatchObject({
      behavior: 'allow',
      updatedInput: {
        deliver_to: {
          channel: 'telegram',
          peer_id: 'peer-1',
          account_id: 'content_sm',
        },
      },
    });
  });

  it('does not overwrite explicit manage_cron deliver_to', async () => {
    const fn = createCanUseTool({ agent: makeAgent(), approvalBroker: new ApprovalBroker(), sessionContext: ctx });
    const deliverTo = { channel: 'telegram', peer_id: 'other-peer', account_id: 'default' };
    const result = await fn(
      'mcp__test__manage_cron',
      { action: 'create', id: 'daily', schedule: '0 9 * * *', prompt: 'hello', deliver_to: deliverTo },
      { signal, toolUseID: 't-cron-explicit' },
    );
    expect(result).toMatchObject({
      behavior: 'allow',
      updatedInput: {
        deliver_to: deliverTo,
      },
    });
  });

  it('does not fill manage_cron deliver_to for non-create actions', async () => {
    const fn = createCanUseTool({ agent: makeAgent(), approvalBroker: new ApprovalBroker(), sessionContext: ctx });
    const result = await fn(
      'mcp__test__manage_cron',
      { action: 'list' },
      { signal, toolUseID: 't-cron-list' },
    );
    expect(result).toMatchObject({
      behavior: 'allow',
      updatedInput: { action: 'list' },
    });
    expect((result as any).updatedInput.deliver_to).toBeUndefined();
  });

  it('respects deny_tools override (deny still wins on chat)', async () => {
    const fn = createCanUseTool({
      agent: makeAgent({ deny_tools: ['Bash'] }),
      approvalBroker: new ApprovalBroker(),
      sessionContext: ctx,
    });
    const result = await fn('Bash', { command: 'rm -rf /' }, { signal, toolUseID: 't3' });
    expect(result.behavior).toBe('deny');
  });

  it('does NOT trigger approval for any built-in tool', async () => {
    const fn = createCanUseTool({ agent: makeAgent(), approvalBroker: new ApprovalBroker(), sessionContext: ctx });
    for (const name of ['Read', 'Write', 'Edit', 'Bash', 'WebFetch']) {
      const result = await fn(name, {}, { signal, toolUseID: `t-${name}` });
      expect(result.behavior).toBe('allow');
    }
  });
});
