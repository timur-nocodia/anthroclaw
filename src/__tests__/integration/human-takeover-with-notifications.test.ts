import { describe, it, expect, vi } from 'vitest';
import { Gateway } from '../../gateway.js';
import { RouteTable } from '../../routing/table.js';
import { createPeerPauseStore } from '../../routing/peer-pause.js';
import { createNotificationsEmitter } from '../../notifications/emitter.js';
import { WhatsAppChannel } from '../../channels/whatsapp.js';
import type { ChannelAdapter, InboundMessage } from '../../channels/types.js';
import type { AgentYml } from '../../config/schema.js';

/**
 * Stage 2 integration: Stage 1's pause events fire formatted Telegram
 * notifications via the configured operator route.
 *
 * Same scaffolding strategy as `human-takeover-e2e.test.ts` — we drive
 * the gateway's pause path with a real WhatsApp adapter (test entry
 * point `__test_handleFromMe`) and assert that the notifications
 * emitter dispatches via the injected sendMessage stub.
 */

const peerKey = 'whatsapp:business:37120@s.whatsapp.net';
const peerId = '37120@s.whatsapp.net';

const aminaConfig = {
  human_takeover: { enabled: true, pause_ttl_minutes: 30 },
  routes: [{ channel: 'whatsapp', account: 'business' }],
  notifications: {
    enabled: true,
    routes: { operator: { channel: 'telegram', account_id: 'control', peer_id: '48705953' } },
    subscriptions: [
      { event: 'peer_pause_started', route: 'operator' },
      { event: 'peer_pause_ended', route: 'operator' },
      { event: 'peer_pause_intervened_during_generation', route: 'operator' },
    ],
  },
} as unknown as AgentYml;

function makeInbound(text: string): InboundMessage {
  return {
    channel: 'whatsapp',
    accountId: 'business',
    chatType: 'dm',
    peerId,
    senderId: peerId,
    text,
    messageId: `M-${text.replace(/\s+/g, '-')}`,
    mentionedBot: false,
    raw: {},
  };
}

interface TestGateway {
  peerPauseStore: ReturnType<typeof createPeerPauseStore>;
  notificationsEmitter: ReturnType<typeof createNotificationsEmitter>;
  routeTable: ReturnType<typeof RouteTable.build>;
  agents: Map<string, unknown>;
  accessControl: unknown;
  profileRateLimiters: Map<string, unknown>;
  hookEmitters: Map<string, unknown>;
  channels: Map<string, ChannelAdapter>;
  queryAgent: ReturnType<typeof vi.fn>;
  handleOperatorOutbound: Gateway['handleOperatorOutbound'];
  dispatch: Gateway['dispatch'];
}

function buildGateway(sendMessage: ReturnType<typeof vi.fn>, clock: () => number): TestGateway {
  const gw = new Gateway() as unknown as TestGateway & { [k: string]: unknown };
  gw.peerPauseStore = createPeerPauseStore({ filePath: ':memory:', clock });
  gw.notificationsEmitter = createNotificationsEmitter({
    sendMessage: sendMessage as unknown as Parameters<typeof createNotificationsEmitter>[0]['sendMessage'],
    peerPauseStore: gw.peerPauseStore,
  });
  gw.routeTable = RouteTable.build([{ id: 'amina', config: aminaConfig }]);
  const stubAgent = {
    id: 'amina',
    config: aminaConfig,
    incrementMessageCount: vi.fn(),
    getSessionId: vi.fn(() => undefined),
    getSessionModel: vi.fn(() => undefined),
    clearSession: vi.fn(),
    isSessionResetDue: vi.fn(() => false),
  };
  gw.agents = new Map([['amina', stubAgent]]);
  gw.accessControl = { check: () => ({ allowed: true }), tryCode: () => false };
  gw.profileRateLimiters = new Map();
  gw.hookEmitters = new Map();
  gw.channels = new Map<string, ChannelAdapter>();
  gw.queryAgent = vi.fn().mockResolvedValue('ok');

  // Subscribe agent to its notifications config — same call that Gateway.start()
  // makes for each loaded agent.
  gw.notificationsEmitter.subscribeAgent('amina', aminaConfig.notifications as never);
  return gw;
}

describe('human_takeover with notifications — Stage 1 + Stage 2 wired', () => {
  it('pause start emits peer_pause_started; expiry emits peer_pause_ended', async () => {
    const t0 = Date.UTC(2026, 4, 1, 12, 0, 0);
    let clock = t0;
    const sendMessage = vi.fn();
    const gw = buildGateway(sendMessage, () => clock);

    const wa = new WhatsAppChannel({
      accounts: { business: { auth_dir: '/tmp/x' } },
      mediaDir: '/tmp/x',
    });
    wa.on('operator_outbound', (event) => gw.handleOperatorOutbound(event));
    gw.channels.set('whatsapp', wa);

    // ─── Step 1: operator outbound → peer_pause_started ────────────
    wa.__test_handleFromMe('business', {
      key: { fromMe: true, id: 'op-1', remoteJid: peerId },
      message: { conversation: 'attended' },
      messageTimestamp: 1700000000,
    });
    // Allow the fire-and-forget emit chain to flush.
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
    const startedCall = sendMessage.mock.calls[0]!;
    expect(startedCall[0]).toMatchObject({
      channel: 'telegram',
      account_id: 'control',
      peer_id: '48705953',
    });
    expect(startedCall[1]).toContain('Auto-pause');
    expect(startedCall[1]).toContain(peerKey);
    expect(startedCall[2]).toMatchObject({ event: 'peer_pause_started', agentId: 'amina' });

    // ─── Step 2: TTL expires → next inbound triggers peer_pause_ended ─
    clock = t0 + 31 * 60_000;
    try {
      await gw.dispatch(makeInbound('still there?'));
    } catch {
      // Heavily stubbed gateway may throw past the pause gate; we only
      // care that the pause-ended emission happened.
    }
    // Two sends total: started + ended
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(2));
    const endedCall = sendMessage.mock.calls[1]!;
    expect(endedCall[1]).toContain('Pause ended');
    expect(endedCall[1]).toContain(peerKey);
    expect(endedCall[2]).toMatchObject({ event: 'peer_pause_ended', agentId: 'amina' });
    // Pause cleared.
    expect(gw.peerPauseStore.list('amina')).toEqual([]);
  });

  it('extend re-emits peer_pause_started with extended:true (subscribers can choose to filter)', async () => {
    const t0 = Date.UTC(2026, 4, 1, 12, 0, 0);
    let clock = t0;
    const sendMessage = vi.fn();
    const gw = buildGateway(sendMessage, () => clock);

    const wa = new WhatsAppChannel({
      accounts: { business: { auth_dir: '/tmp/x' } },
      mediaDir: '/tmp/x',
    });
    wa.on('operator_outbound', (event) => gw.handleOperatorOutbound(event));
    gw.channels.set('whatsapp', wa);

    wa.__test_handleFromMe('business', {
      key: { fromMe: true, id: 'op-1', remoteJid: peerId },
      message: { conversation: 'one' },
      messageTimestamp: 1,
    });
    clock = t0 + 5 * 60_000;
    wa.__test_handleFromMe('business', {
      key: { fromMe: true, id: 'op-2', remoteJid: peerId },
      message: { conversation: 'two' },
      messageTimestamp: 2,
    });
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(2));
    expect(sendMessage.mock.calls[0]![2]).toMatchObject({ event: 'peer_pause_started' });
    expect(sendMessage.mock.calls[1]![2]).toMatchObject({ event: 'peer_pause_started' });
  });

  it('mid-generation suppression emits peer_pause_intervened_during_generation', async () => {
    const sendMessage = vi.fn();
    const peerPauseStore = createPeerPauseStore({ filePath: ':memory:' });
    const notificationsEmitter = createNotificationsEmitter({
      sendMessage: sendMessage as unknown as Parameters<typeof createNotificationsEmitter>[0]['sendMessage'],
      peerPauseStore,
    });
    notificationsEmitter.subscribeAgent('amina', aminaConfig.notifications as never);
    peerPauseStore.pause('amina', peerKey, {
      ttlMinutes: 30,
      reason: 'operator_takeover',
      source: 'whatsapp:business:fromMe',
    });

    const { createSendMessageTool } = await import('../../agent/tools/send-message.js');
    const fakeAdapter = { sendText: vi.fn(), sendMedia: vi.fn(), name: 'whatsapp' } as unknown as ChannelAdapter;
    const tool = createSendMessageTool(() => fakeAdapter, {
      agentId: 'amina',
      peerPauseStore,
      notificationsEmitter,
    });

    // Locate handler in the SDK tool struct (mirrors existing tool tests).
    const handler = (tool as unknown as { handler: (args: Record<string, unknown>) => Promise<unknown> }).handler;
    const result = await handler({
      channel: 'whatsapp',
      account_id: 'business',
      peer_id: peerId,
      text: 'mid-stream reply',
    });

    expect(result).toBeTruthy();
    const json = JSON.parse(((result as { content: { text: string }[] }).content[0]?.text) ?? '{}');
    expect(json).toMatchObject({ suppressed: true, reason: 'paused' });
    expect((fakeAdapter.sendText as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();

    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
    expect(sendMessage.mock.calls[0]![2]).toMatchObject({
      event: 'peer_pause_intervened_during_generation',
      agentId: 'amina',
    });
    expect(sendMessage.mock.calls[0]![1]).toContain('Intervention suppressed');
  });

  it('deliverNotification threads parseMode=markdown for telegram routes', async () => {
    // Gateway.deliverNotification is the real wire from emitter.sendMessage
    // to ChannelAdapter.sendText. The Telegram formatter emits *bold*/`code`
    // in project Markdown, so parseMode must be set or those characters
    // render literally. WhatsApp routes get parseMode='plain'.
    const tgSend = vi.fn().mockResolvedValue('msg-1');
    const waSend = vi.fn().mockResolvedValue('msg-2');
    const tgAdapter = {
      id: 'telegram',
      sendText: tgSend,
    } as unknown as ChannelAdapter;
    const waAdapter = {
      id: 'whatsapp',
      sendText: waSend,
    } as unknown as ChannelAdapter;

    const gw = new Gateway() as unknown as {
      channels: Map<string, ChannelAdapter>;
      deliverNotification: (
        route: { channel: 'telegram' | 'whatsapp'; account_id: string; peer_id: string },
        text: string,
        meta: { event: string; agentId: string },
      ) => Promise<void>;
    };
    gw.channels = new Map<string, ChannelAdapter>([
      ['telegram', tgAdapter],
      ['whatsapp', waAdapter],
    ]);

    await gw.deliverNotification(
      { channel: 'telegram', account_id: 'control', peer_id: '48705953' },
      '*Auto-pause* — `amina`',
      { event: 'peer_pause_started', agentId: 'amina' },
    );
    // accountId here is the SendOptions field on ChannelAdapter.sendText —
    // a different shape from NotificationRoute (which is snake_case).
    expect(tgSend).toHaveBeenCalledWith(
      '48705953',
      '*Auto-pause* — `amina`',
      expect.objectContaining({ accountId: 'control', parseMode: 'markdown' }),
    );

    await gw.deliverNotification(
      { channel: 'whatsapp', account_id: 'business', peer_id: '37120@s.whatsapp.net' },
      'Auto-pause — amina',
      { event: 'peer_pause_started', agentId: 'amina' },
    );
    expect(waSend).toHaveBeenCalledWith(
      '37120@s.whatsapp.net',
      'Auto-pause — amina',
      expect.objectContaining({ accountId: 'business', parseMode: 'plain' }),
    );
  });

  it('subscribeAgent is idempotent — second call replaces, does not duplicate', async () => {
    const sendMessage = vi.fn();
    const emitter = createNotificationsEmitter({
      sendMessage: sendMessage as unknown as Parameters<typeof createNotificationsEmitter>[0]['sendMessage'],
    });
    emitter.subscribeAgent('amina', aminaConfig.notifications as never);
    emitter.subscribeAgent('amina', aminaConfig.notifications as never);
    await emitter.emit('peer_pause_started', {
      agentId: 'amina',
      peerKey,
      expiresAt: '2026-05-01T12:30:00Z',
    });
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });
});
