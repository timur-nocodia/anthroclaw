import { describe, it, expect } from 'vitest';
import { canManageAgent } from '../cross-agent-perm.js';

describe('canManageAgent', () => {
  it('self always allowed when target matches caller (no config required)', () => {
    expect(
      canManageAgent({ callerId: 'agent_alpha', targetId: 'agent_alpha', operatorConsoleConfig: undefined }),
    ).toBe(true);
  });

  it('self always allowed even when operator_console disabled', () => {
    expect(
      canManageAgent({
        callerId: 'agent_alpha',
        targetId: 'agent_alpha',
        operatorConsoleConfig: { enabled: false, manages: [] },
      }),
    ).toBe(true);
  });

  it('cross-agent without operator_console config is denied', () => {
    expect(
      canManageAgent({
        callerId: 'operator_agent',
        targetId: 'agent_alpha',
        operatorConsoleConfig: undefined,
      }),
    ).toBe(false);
  });

  it('cross-agent with disabled operator_console is denied', () => {
    expect(
      canManageAgent({
        callerId: 'operator_agent',
        targetId: 'agent_alpha',
        operatorConsoleConfig: { enabled: false, manages: ['agent_alpha'] },
      }),
    ).toBe(false);
  });

  it('cross-agent with target in manages array is allowed', () => {
    expect(
      canManageAgent({
        callerId: 'operator_agent',
        targetId: 'agent_alpha',
        operatorConsoleConfig: { enabled: true, manages: ['agent_alpha'] },
      }),
    ).toBe(true);
  });

  it('cross-agent with target NOT in manages array is denied', () => {
    expect(
      canManageAgent({
        callerId: 'operator_agent',
        targetId: 'secondary_agent',
        operatorConsoleConfig: { enabled: true, manages: ['agent_alpha'] },
      }),
    ).toBe(false);
  });

  it('manages: "*" allows any target', () => {
    expect(
      canManageAgent({
        callerId: 'operator_agent',
        targetId: 'literally-anyone',
        operatorConsoleConfig: { enabled: true, manages: '*' },
      }),
    ).toBe(true);
  });

  it('empty manages array denies every concrete target', () => {
    expect(
      canManageAgent({
        callerId: 'operator_agent',
        targetId: 'agent_alpha',
        operatorConsoleConfig: { enabled: true, manages: [] },
      }),
    ).toBe(false);
  });
});
