import { describe, it, expect, vi } from 'vitest';
import { createSendMessageTool } from '../send-message.js';
import { createPeerPauseStore } from '../../../routing/peer-pause.js';
import type { ChannelAdapter } from '../../../channels/types.js';

/**
 * Build a fake ChannelAdapter that records sendText calls.
 */
function makeFakeAdapter() {
  const sendText = vi.fn(async (peerId: string, text: string) => `mid:${peerId}:${text.length}`);
  const adapter: Partial<ChannelAdapter> = {
    id: 'whatsapp',
    sendText: sendText as unknown as ChannelAdapter['sendText'],
    supportsApproval: false,
  };
  return { adapter: adapter as ChannelAdapter, sendText };
}

function getHandler(tool: unknown) {
  // The SDK's tool() returns an object with a handler(args, extra) function.
  return (tool as { handler: (a: Record<string, unknown>, e?: unknown) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> }).handler;
}

describe('send_message — pause suppression', () => {
  it('suppresses send when peer is paused mid-generation', async () => {
    const store = createPeerPauseStore({ filePath: ':memory:' });
    store.pause('amina', 'whatsapp:business:37120@s.whatsapp.net', {
      ttlMinutes: 30,
      reason: 'operator_takeover',
      source: 'wa',
    });
    const { adapter, sendText } = makeFakeAdapter();
    const tool = createSendMessageTool(() => adapter, {
      agentId: 'amina',
      peerPauseStore: store,
    });

    const handler = getHandler(tool);
    const result = await handler({
      channel: 'whatsapp',
      account_id: 'business',
      peer_id: '37120@s.whatsapp.net',
      text: 'reply that should be suppressed',
    });

    expect(sendText).not.toHaveBeenCalled();
    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(result.content[0].text);
    expect(payload).toMatchObject({
      suppressed: true,
      reason: 'paused',
    });
    expect(typeof payload.expires_at).toBe('string');
  });

  it('still sends to non-paused peers normally', async () => {
    const store = createPeerPauseStore({ filePath: ':memory:' });
    const { adapter, sendText } = makeFakeAdapter();
    const tool = createSendMessageTool(() => adapter, {
      agentId: 'amina',
      peerPauseStore: store,
    });

    const handler = getHandler(tool);
    const result = await handler({
      channel: 'whatsapp',
      account_id: 'business',
      peer_id: 'someone-else@s.whatsapp.net',
      text: 'normal send',
    });

    expect(sendText).toHaveBeenCalledOnce();
    expect(sendText).toHaveBeenCalledWith('someone-else@s.whatsapp.net', 'normal send', {
      accountId: 'business',
    });
    expect(result.content[0].text).toContain('Message sent.');
  });

  it('does NOT suppress when pause is for a different agent', async () => {
    const store = createPeerPauseStore({ filePath: ':memory:' });
    store.pause('larry', 'whatsapp:business:37120@s.whatsapp.net', {
      ttlMinutes: 30,
      reason: 'operator_takeover',
      source: 'wa',
    });
    const { adapter, sendText } = makeFakeAdapter();
    const tool = createSendMessageTool(() => adapter, {
      agentId: 'amina',
      peerPauseStore: store,
    });

    const handler = getHandler(tool);
    await handler({
      channel: 'whatsapp',
      account_id: 'business',
      peer_id: '37120@s.whatsapp.net',
      text: 'send for amina',
    });

    expect(sendText).toHaveBeenCalledOnce();
  });

  it('still sends if pause has expired', async () => {
    const t0 = Date.UTC(2026, 4, 1, 12, 0, 0);
    let clock = t0;
    const store = createPeerPauseStore({ filePath: ':memory:', clock: () => clock });
    store.pause('amina', 'whatsapp:business:37120@s.whatsapp.net', {
      ttlMinutes: 30,
      reason: 'operator_takeover',
      source: 'wa',
    });
    clock = t0 + 31 * 60_000;

    const { adapter, sendText } = makeFakeAdapter();
    const tool = createSendMessageTool(() => adapter, {
      agentId: 'amina',
      peerPauseStore: store,
    });

    const handler = getHandler(tool);
    await handler({
      channel: 'whatsapp',
      account_id: 'business',
      peer_id: '37120@s.whatsapp.net',
      text: 'after expiry',
    });

    expect(sendText).toHaveBeenCalledOnce();
  });

  it('omits agentId/peerPauseStore => standard send (subsystem disabled at construction)', async () => {
    const { adapter, sendText } = makeFakeAdapter();
    const tool = createSendMessageTool(() => adapter);

    const handler = getHandler(tool);
    await handler({
      channel: 'whatsapp',
      account_id: 'business',
      peer_id: '37120@s.whatsapp.net',
      text: 'hi',
    });

    expect(sendText).toHaveBeenCalledOnce();
  });
});
