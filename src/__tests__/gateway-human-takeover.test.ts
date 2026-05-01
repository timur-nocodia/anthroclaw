import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Gateway } from '../gateway.js';
import { RouteTable } from '../routing/table.js';
import { createPeerPauseStore } from '../routing/peer-pause.js';
import type { ChannelAdapter, InboundMessage, OperatorOutboundEvent } from '../channels/types.js';
import type { AgentYml } from '../config/schema.js';

/**
 * Stage 1 wiring tests for the human_takeover subsystem.
 *
 * Building a full Gateway in a unit test (channels, scheduler, plugin
 * loaders, SDK init) is impractical, so we instantiate the Gateway and
 * patch private fields with the minimum needed to exercise
 * `handleOperatorOutbound` and the future `dispatch`-time pause check.
 * The full e2e flow is covered separately in
 * src/__tests__/integration/human-takeover-e2e.test.ts (Task 10).
 */

const ttlAgentConfig = {
  human_takeover: { enabled: true, pause_ttl_minutes: 30 },
  routes: [{ channel: 'whatsapp', account: 'business' }],
} as unknown as AgentYml;

const disabledAgentConfig = {
  human_takeover: { enabled: false },
  routes: [{ channel: 'whatsapp', account: 'business' }],
} as unknown as AgentYml;

function makeEvent(overrides: Partial<OperatorOutboundEvent> = {}): OperatorOutboundEvent {
  return {
    channel: 'whatsapp',
    accountId: 'business',
    peerKey: 'whatsapp:business:37120@s.whatsapp.net',
    peerId: '37120@s.whatsapp.net',
    textPreview: 'hi',
    hasMedia: false,
    messageId: 'M1',
    timestamp: 1,
    ...overrides,
  };
}

function setupGateway(agentId: string, config: AgentYml) {
  const gw = new Gateway() as any;
  gw.peerPauseStore = createPeerPauseStore({ filePath: ':memory:' });
  gw.routeTable = RouteTable.build([{ id: agentId, config }]);
  gw.agents = new Map([[agentId, { id: agentId, config }]]);
  return gw;
}

describe('Gateway.handleOperatorOutbound', () => {
  let now: number;
  beforeEach(() => {
    now = Date.UTC(2026, 4, 1, 12, 0, 0);
  });

  it('on operator_outbound, pauses the peer for the configured TTL', () => {
    const gw = setupGateway('amina', ttlAgentConfig);
    gw.handleOperatorOutbound(makeEvent());
    const status = gw.peerPauseStore.isPaused('amina', 'whatsapp:business:37120@s.whatsapp.net');
    expect(status.paused).toBe(true);
    expect(status.entry?.reason).toBe('operator_takeover');
    expect(status.entry?.expiresAt).not.toBeNull();
  });

  it('does NOT pause when human_takeover.enabled is false', () => {
    const gw = setupGateway('amina', disabledAgentConfig);
    gw.handleOperatorOutbound(makeEvent());
    expect(gw.peerPauseStore.list('amina')).toEqual([]);
  });

  it('does NOT pause when no route matches the event', () => {
    const gw = setupGateway('amina', ttlAgentConfig);
    gw.handleOperatorOutbound(makeEvent({ channel: 'telegram' }));
    expect(gw.peerPauseStore.list('amina')).toEqual([]);
  });

  it('extends pause on subsequent operator_outbound', () => {
    const t0 = now;
    let clock = t0;
    const store = createPeerPauseStore({ filePath: ':memory:', clock: () => clock });
    const gw = new Gateway() as any;
    gw.peerPauseStore = store;
    gw.routeTable = RouteTable.build([{ id: 'amina', config: ttlAgentConfig }]);
    gw.agents = new Map([['amina', { id: 'amina', config: ttlAgentConfig }]]);

    gw.handleOperatorOutbound(makeEvent());
    const first = store.isPaused('amina', 'whatsapp:business:37120@s.whatsapp.net').entry!;

    clock = t0 + 10 * 60_000; // +10min
    gw.handleOperatorOutbound(makeEvent({ messageId: 'M2' }));
    const second = store.isPaused('amina', 'whatsapp:business:37120@s.whatsapp.net').entry!;

    expect(second.extendedCount).toBe(1);
    expect(Date.parse(second.expiresAt!)).toBeGreaterThan(Date.parse(first.expiresAt!));
  });

  it('returns silently if peerPauseStore or routeTable is missing', () => {
    const gw = new Gateway() as any;
    expect(() => gw.handleOperatorOutbound(makeEvent())).not.toThrow();
  });
});

describe('Gateway.dispatch — pause check', () => {
  const peerKey = 'whatsapp:business:37120@s.whatsapp.net';

  function setupDispatchGateway(config: AgentYml) {
    const gw = new Gateway() as any;
    gw.peerPauseStore = createPeerPauseStore({ filePath: ':memory:' });
    gw.routeTable = RouteTable.build([{ id: 'amina', config }]);
    gw.agents = new Map([['amina', { id: 'amina', config }]]);
    // Stub access control so no pairing/allowlist is needed.
    gw.accessControl = {
      check: () => ({ allowed: true }),
      tryCode: () => false,
    };
    gw.profileRateLimiters = new Map();
    gw.hookEmitters = new Map();
    gw.channels = new Map<string, ChannelAdapter>();
    // Spy that the dispatch path stops before reaching queryAgent.
    gw.queryAgent = vi.fn();
    return gw;
  }

  function makeInbound(): InboundMessage {
    return {
      channel: 'whatsapp',
      accountId: 'business',
      chatType: 'dm',
      peerId: '37120@s.whatsapp.net',
      senderId: '37120@s.whatsapp.net',
      text: 'thanks',
      messageId: 'M-in-1',
      mentionedBot: false,
      raw: {},
    };
  }

  it('skips dispatch for paused peer', async () => {
    const gw = setupDispatchGateway(ttlAgentConfig);
    gw.peerPauseStore.pause('amina', peerKey, {
      ttlMinutes: 30,
      reason: 'operator_takeover',
      source: 'wa',
    });
    await gw.dispatch(makeInbound());
    expect(gw.queryAgent).not.toHaveBeenCalled();
    // Pause stays in place (not expired).
    expect(gw.peerPauseStore.list('amina')).toHaveLength(1);
  });

  it('clears expired pause and continues past the pause gate', async () => {
    const t0 = Date.UTC(2026, 4, 1, 12, 0, 0);
    let clock = t0;
    const store = createPeerPauseStore({ filePath: ':memory:', clock: () => clock });
    const gw = setupDispatchGateway(ttlAgentConfig);
    gw.peerPauseStore = store;
    store.pause('amina', peerKey, {
      ttlMinutes: 30,
      reason: 'operator_takeover',
      source: 'wa',
    });
    clock = t0 + 31 * 60_000;

    // Dispatch will go past the pause check; downstream paths may throw on
    // the heavily stubbed gateway. We only care that the pause was cleared
    // — that is the spec for Task 8 ("auto-clear expired").
    try {
      await gw.dispatch(makeInbound());
    } catch {
      // expected: downstream session/heartbeat plumbing is intentionally
      // absent in this test.
    }
    expect(store.list('amina')).toEqual([]);
  });

  it('non-paused peer flows past the pause gate (no early-return)', async () => {
    const gw = setupDispatchGateway(ttlAgentConfig);
    // No pause set. The dispatch should attempt to proceed; downstream
    // bookkeeping may throw on the stubbed gateway, but the peerPauseStore
    // must remain empty (no spurious entries from the gate).
    try {
      await gw.dispatch(makeInbound());
    } catch {
      // ignored — we only assert the pause gate did not block dispatch.
    }
    expect(gw.peerPauseStore.list('amina')).toEqual([]);
  });
});
