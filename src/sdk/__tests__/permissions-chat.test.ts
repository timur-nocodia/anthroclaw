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

const ctx = { peerId: 'peer-1' };
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
