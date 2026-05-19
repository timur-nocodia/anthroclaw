import { describe, it, expect, vi } from 'vitest';
import { Gateway } from '../gateway.js';
import type { InboundMessage } from '../channels/types.js';
import type { AgentYml } from '../config/schema.js';

/**
 * Direct tests for `Gateway.dispatchSyntheticInbound`. Building a real
 * Gateway is heavy, so we patch the minimum surface: a stub agent map and
 * a spy `queryAgent` to capture the InboundMessage the synthetic dispatch
 * hands off.
 *
 * Focus:
 *   - default sender labels remain backwards-compatible (operator-console)
 *   - MCP-onboarding callers can override senderId/senderName and tag the
 *     synthetic source so the inbound is not mislabelled in audit logs.
 */

interface GatewayInternals {
  agents: Map<string, unknown>;
  queryAgent: (...args: unknown[]) => Promise<unknown>;
  dispatchSyntheticInbound: Gateway['dispatchSyntheticInbound'];
}

function setupGateway(agentId: string) {
  const gw = new Gateway() as unknown as GatewayInternals;
  gw.agents = new Map([[agentId, { id: agentId, config: {} as AgentYml }]]);
  const calls: InboundMessage[] = [];
  gw.queryAgent = vi.fn(async (...args: unknown[]) => {
    calls.push(args[1] as InboundMessage);
    return 'ok';
  });
  return { gw, calls };
}

describe('Gateway.dispatchSyntheticInbound', () => {
  it('defaults sender labels to operator-console for backwards compatibility', async () => {
    const { gw, calls } = setupGateway('agent_alpha');
    await gw.dispatchSyntheticInbound({
      targetAgentId: 'agent_alpha',
      channel: 'telegram',
      peerId: '123',
      text: 'hi',
    });
    // queryAgent is fire-and-forget; await a tick.
    await new Promise((r) => setTimeout(r, 10));
    expect(calls).toHaveLength(1);
    expect(calls[0].senderId).toBe('operator-console');
    expect(calls[0].senderName).toBe('operator-console');
    expect((calls[0].raw as Record<string, unknown>).synthetic).toBe('operator_console');
    // Legacy field still set so older readers keep working.
    expect((calls[0].raw as Record<string, unknown>).operatorConsole).toBe(true);
  });

  it('honours overridden sender labels and tags raw.synthetic accordingly', async () => {
    const { gw, calls } = setupGateway('agent_alpha');
    await gw.dispatchSyntheticInbound({
      targetAgentId: 'agent_alpha',
      channel: 'telegram',
      peerId: '123',
      text: '[system] mcp_connected: notion',
      senderId: 'mcp-onboarding',
      senderName: 'mcp-onboarding',
      syntheticSource: 'mcp_onboarding',
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(calls).toHaveLength(1);
    expect(calls[0].senderId).toBe('mcp-onboarding');
    expect(calls[0].senderName).toBe('mcp-onboarding');
    expect((calls[0].raw as Record<string, unknown>).synthetic).toBe('mcp_onboarding');
    // operatorConsole legacy flag should be false for non-operator sources.
    expect((calls[0].raw as Record<string, unknown>).operatorConsole).toBe(false);
  });

  it('merges caller-provided meta into raw alongside the synthetic tag', async () => {
    const { gw, calls } = setupGateway('agent_alpha');
    await gw.dispatchSyntheticInbound({
      targetAgentId: 'agent_alpha',
      channel: 'whatsapp',
      peerId: '37120@s.whatsapp.net',
      text: '[system] mcp_connect_failed: notion',
      senderId: 'mcp-onboarding',
      senderName: 'mcp-onboarding',
      syntheticSource: 'mcp_onboarding',
      meta: {
        source: 'mcp_oauth_failed',
        pendingId: 'pnd_x',
        serverId: 'notion',
      },
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(calls).toHaveLength(1);
    expect((calls[0].raw as Record<string, unknown>).source).toBe('mcp_oauth_failed');
    expect((calls[0].raw as Record<string, unknown>).pendingId).toBe('pnd_x');
    expect((calls[0].raw as Record<string, unknown>).serverId).toBe('notion');
    expect((calls[0].raw as Record<string, unknown>).synthetic).toBe('mcp_onboarding');
  });
});
