import { describe, it, expect } from 'vitest';
import { WhatsAppChannel } from '../whatsapp.js';
import type { OperatorOutboundEvent } from '../types.js';

/**
 * Integration test for the WhatsApp adapter's operator_outbound emission.
 *
 * Note: spinning up Baileys in unit tests is impractical (it opens a real
 * websocket and depends on auth state). Instead we use `__test_handleFromMe`,
 * which is the same path the live socket calls when `messages.upsert` fires
 * with `key.fromMe = true`. Coverage of the wiring (classifier → event
 * payload) is what this test guarantees; the Baileys socket plumbing itself
 * is exercised at runtime, not in vitest.
 */
function makeAdapter(): WhatsAppChannel {
  return new WhatsAppChannel({ accounts: { business: { auth_dir: '/tmp/x' } }, mediaDir: '/tmp/x' });
}

describe('WhatsAppChannel — operator_outbound event', () => {
  it('emits operator_outbound for fromMe text message', () => {
    const adapter = makeAdapter();
    const events: OperatorOutboundEvent[] = [];
    adapter.on('operator_outbound', (e) => events.push(e));

    adapter.__test_handleFromMe('business', {
      key: { fromMe: true, id: 'M1', remoteJid: '37120@s.whatsapp.net' },
      message: { conversation: 'hi from operator' },
      messageTimestamp: 1700000000,
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      channel: 'whatsapp',
      accountId: 'business',
      peerKey: 'whatsapp:business:37120@s.whatsapp.net',
      peerId: '37120@s.whatsapp.net',
      textPreview: 'hi from operator',
      hasMedia: false,
      messageId: 'M1',
      timestamp: 1700000000,
    });
  });

  it('emits operator_outbound with hasMedia=true for fromMe image', () => {
    const adapter = makeAdapter();
    const events: OperatorOutboundEvent[] = [];
    adapter.on('operator_outbound', (e) => events.push(e));

    adapter.__test_handleFromMe('business', {
      key: { fromMe: true, id: 'M2', remoteJid: 'g@g.us' },
      message: { imageMessage: { caption: 'pic' } },
      messageTimestamp: 1,
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      hasMedia: true,
      textPreview: 'pic',
      peerKey: 'whatsapp:business:g@g.us',
    });
  });

  it('does NOT emit for fromMe reaction', () => {
    const adapter = makeAdapter();
    const events: OperatorOutboundEvent[] = [];
    adapter.on('operator_outbound', (e) => events.push(e));

    adapter.__test_handleFromMe('business', {
      key: { fromMe: true, id: 'R1', remoteJid: '37120@s.whatsapp.net' },
      message: { reactionMessage: {} },
      messageTimestamp: 1,
    });

    expect(events).toHaveLength(0);
  });

  it('does NOT emit for fromMe protocol envelope', () => {
    const adapter = makeAdapter();
    const events: OperatorOutboundEvent[] = [];
    adapter.on('operator_outbound', (e) => events.push(e));

    adapter.__test_handleFromMe('business', {
      key: { fromMe: true, id: 'P1', remoteJid: '37120@s.whatsapp.net' },
      message: { protocolMessage: {} },
      messageTimestamp: 1,
    });

    expect(events).toHaveLength(0);
  });

  it('does NOT emit when remoteJid is missing', () => {
    const adapter = makeAdapter();
    const events: OperatorOutboundEvent[] = [];
    adapter.on('operator_outbound', (e) => events.push(e));

    adapter.__test_handleFromMe('business', {
      key: { fromMe: true, id: 'X' },
      message: { conversation: 'hey' },
      messageTimestamp: 1,
    });

    expect(events).toHaveLength(0);
  });

  it('off() removes listener', () => {
    const adapter = makeAdapter();
    const events: OperatorOutboundEvent[] = [];
    const listener = (e: OperatorOutboundEvent) => events.push(e);
    adapter.on('operator_outbound', listener);
    adapter.off('operator_outbound', listener);

    adapter.__test_handleFromMe('business', {
      key: { fromMe: true, id: 'M', remoteJid: 'r' },
      message: { conversation: 'hi' },
      messageTimestamp: 1,
    });

    expect(events).toHaveLength(0);
  });
});
