import { describe, it, expect } from 'vitest';
import type { InboundMessage, ChannelAdapter, SendOptions, OutboundMedia, InlineButton, InboundMedia } from '../../src/channels/types.js';

describe('Channel types', () => {
  it('InboundMessage has required fields', () => {
    const msg: InboundMessage = {
      channel: 'telegram',
      accountId: 'default',
      chatType: 'dm',
      peerId: '123',
      senderId: '456',
      text: 'hello',
      messageId: 'msg1',
      mentionedBot: false,
      raw: {},
    };
    expect(msg.channel).toBe('telegram');
  });

  it('OutboundMedia accepts buffer or path', () => {
    const withPath: OutboundMedia = { type: 'image', path: '/tmp/img.jpg', mimeType: 'image/jpeg' };
    const withBuffer: OutboundMedia = { type: 'document', buffer: Buffer.from('test'), mimeType: 'application/pdf' };
    expect(withPath.path).toBeTruthy();
    expect(withBuffer.buffer).toBeTruthy();
  });

  it('ChannelAdapter interface requires editText method', () => {
    // Verify that a conforming ChannelAdapter object must include editText
    const adapter: ChannelAdapter = {
      id: 'telegram',
      async start() {},
      async stop() {},
      onMessage() {},
      async sendText() { return ''; },
      async editText() {},
      async sendMedia() { return ''; },
      async sendTyping() {},
    };
    expect(typeof adapter.editText).toBe('function');
  });

  it('editText is callable with correct arguments', async () => {
    const calls: { peerId: string; messageId: string; text: string }[] = [];
    const adapter: ChannelAdapter = {
      id: 'telegram',
      async start() {},
      async stop() {},
      onMessage() {},
      async sendText() { return ''; },
      async editText(peerId: string, messageId: string, text: string) {
        calls.push({ peerId, messageId, text });
      },
      async sendMedia() { return ''; },
      async sendTyping() {},
    };

    await adapter.editText('peer-1', 'msg-42', 'updated text');
    expect(calls).toEqual([{ peerId: 'peer-1', messageId: 'msg-42', text: 'updated text' }]);
  });
});
