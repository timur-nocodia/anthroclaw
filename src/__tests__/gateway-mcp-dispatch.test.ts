import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { Gateway } from '../gateway.js';
import type { OnboardingEvent } from '../integrations/mcp-onboarding/index.js';

/**
 * Direct coverage for the production wiring in
 *   Gateway.subscribeMcpOnboardingEvents → Gateway.dispatchMcpSystemMessage
 *     → Gateway.dispatchSyntheticInbound
 *
 * Spinning up a real Gateway (channels, scheduler, plugin loaders, SDK
 * init) is impractical here, so we instantiate it and patch only the
 * minimum surface the dispatch path touches:
 *   - `agents`: a stub map so `dispatchSyntheticInbound` finds the target
 *   - `queryAgent`: a no-op so the fire-and-forget call doesn't blow up
 *   - `dispatchSyntheticInbound`: replaced with a recording spy so we can
 *     assert on text + meta produced by the format strings under test.
 *
 * The previous integration test (`connect-mcp-tool.test.ts`) reconstructs
 * the format locally, which means a typo in Gateway's real strings would
 * not be caught. This test pins each of the four [system] mcp_* formats
 * to the production source.
 */

interface GatewayInternals {
  agents: Map<string, unknown>;
  queryAgent: (...args: unknown[]) => Promise<unknown>;
  dispatchSyntheticInbound: (...args: unknown[]) => Promise<unknown>;
  subscribeMcpOnboardingEvents: (onboarding: { events: EventEmitter }) => void;
}

interface DispatchCall {
  targetAgentId: string;
  channel: string;
  peerId: string;
  text: string;
  senderId?: string;
  senderName?: string;
  syntheticSource?: string;
  meta?: Record<string, unknown>;
}

let gw: GatewayInternals;
let dispatchCalls: DispatchCall[];
let onboarding: { events: EventEmitter };

beforeEach(() => {
  dispatchCalls = [];
  gw = new Gateway() as unknown as GatewayInternals;
  gw.agents = new Map([['amina', { id: 'amina', config: {} }]]);
  gw.queryAgent = vi.fn(async () => 'ok');
  gw.dispatchSyntheticInbound = vi.fn(async (...args: unknown[]) => {
    dispatchCalls.push(args[0] as DispatchCall);
    return { messageId: 'm1', sessionKey: 'amina:telegram:dm:123' };
  });
  onboarding = { events: new EventEmitter() };
  gw.subscribeMcpOnboardingEvents(onboarding);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function flushMicrotasks(): Promise<void> {
  // dispatchMcpSystemMessage is called via `void this.…`. Yield twice so
  // the async fn body runs + its awaited dispatchSyntheticInbound resolves.
  return new Promise((r) => setImmediate(r));
}

describe('Gateway.subscribeMcpOnboardingEvents → dispatchMcpSystemMessage', () => {
  const BASE_EVT: OnboardingEvent = {
    pendingId: 'pnd_xyz',
    agentId: 'amina',
    agentSessionKey: 'amina:telegram:dm:123456',
    serverId: 'notion',
  };

  it('connected: dispatches [system] mcp_connected with tools and awaiting finalize', async () => {
    onboarding.events.emit('connected', {
      ...BASE_EVT,
      tools: [
        { name: 'demo_tool', description: 'd' },
        { name: 'other_tool' },
      ],
    } satisfies OnboardingEvent);
    await flushMicrotasks();

    expect(dispatchCalls).toHaveLength(1);
    const call = dispatchCalls[0];
    expect(call.targetAgentId).toBe('amina');
    expect(call.channel).toBe('telegram');
    expect(call.peerId).toBe('123456');
    expect(call.text).toBe(
      '[system] mcp_connected: notion\n'
      + 'server_id: notion\n'
      + 'pending_id: pnd_xyz\n'
      + 'tools: demo_tool, other_tool\n'
      + 'awaiting: finalize',
    );
    expect(call.senderId).toBe('mcp-onboarding');
    expect(call.senderName).toBe('mcp-onboarding');
    expect(call.syntheticSource).toBe('mcp_onboarding');
    expect(call.meta?.source).toBe('mcp_oauth_callback');
    expect(call.meta?.pendingId).toBe('pnd_xyz');
    expect(call.meta?.serverId).toBe('notion');
  });

  it('failed: dispatches [system] mcp_connect_failed with reason', async () => {
    onboarding.events.emit('failed', {
      ...BASE_EVT,
      reason: 'invalid_token',
    } satisfies OnboardingEvent);
    await flushMicrotasks();

    expect(dispatchCalls).toHaveLength(1);
    const call = dispatchCalls[0];
    expect(call.text).toBe(
      '[system] mcp_connect_failed: notion\n'
      + 'pending_id: pnd_xyz\n'
      + 'reason: invalid_token',
    );
    expect(call.meta?.source).toBe('mcp_oauth_failed');
    expect(call.senderId).toBe('mcp-onboarding');
  });

  it('failed: defaults reason to "unknown" when omitted', async () => {
    onboarding.events.emit('failed', BASE_EVT);
    await flushMicrotasks();

    expect(dispatchCalls[0].text).toContain('reason: unknown');
  });

  it('cancelled: dispatches [system] mcp_connect_declined', async () => {
    onboarding.events.emit('cancelled', BASE_EVT);
    await flushMicrotasks();

    expect(dispatchCalls).toHaveLength(1);
    const call = dispatchCalls[0];
    expect(call.text).toBe(
      '[system] mcp_connect_declined: notion\n' + 'pending_id: pnd_xyz',
    );
    expect(call.meta?.source).toBe('mcp_oauth_declined');
  });

  it('timeout: dispatches [system] mcp_connect_timeout', async () => {
    onboarding.events.emit('timeout', BASE_EVT);
    await flushMicrotasks();

    expect(dispatchCalls).toHaveLength(1);
    const call = dispatchCalls[0];
    expect(call.text).toBe(
      '[system] mcp_connect_timeout: notion\n' + 'pending_id: pnd_xyz',
    );
    expect(call.meta?.source).toBe('mcp_pending_expired');
  });

  it('skips dispatch when agentSessionKey is null (admin-initiated)', async () => {
    onboarding.events.emit('connected', {
      ...BASE_EVT,
      agentSessionKey: null,
      tools: [],
    } satisfies OnboardingEvent);
    await flushMicrotasks();

    expect(dispatchCalls).toHaveLength(0);
  });

  it('skips dispatch when agentSessionKey channel is unsupported', async () => {
    onboarding.events.emit('connected', {
      ...BASE_EVT,
      agentSessionKey: 'amina:slack:dm:123456',
      tools: [],
    } satisfies OnboardingEvent);
    await flushMicrotasks();

    expect(dispatchCalls).toHaveLength(0);
  });

  it('queueMode meta field is no longer emitted (was dead informational signal)', async () => {
    onboarding.events.emit('connected', { ...BASE_EVT, tools: [] });
    await flushMicrotasks();
    expect(dispatchCalls[0].meta?.queueMode).toBeUndefined();
  });
});
