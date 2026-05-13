import { describe, expect, it } from 'vitest';
import type { InboundMessage } from '../../../channels/types.js';
import { telegramBuildroomInputFromInboundMessage } from '../inbound.js';

describe('Telegram Buildroom inbound adapter', () => {
  it('maps Telegram inbound messages to Buildroom command input', () => {
    expect(telegramBuildroomInputFromInboundMessage(message({
      text: '/buildroom status',
      senderId: '123456789',
      peerId: '-1001234567890',
      threadId: '2',
      replyToId: '99',
    }))).toEqual({
      text: '/buildroom status',
      telegramUserId: 123456789,
      chatId: -1001234567890,
      messageThreadId: 2,
      replyToMessageId: 99,
    });
  });

  it('returns null for non-Telegram messages or invalid Telegram identities', () => {
    expect(telegramBuildroomInputFromInboundMessage(message({ channel: 'whatsapp' }))).toBeNull();
    expect(telegramBuildroomInputFromInboundMessage(message({ senderId: '', peerId: '-100' }))).toBeNull();
  });

  function message(overrides: Partial<InboundMessage> = {}): InboundMessage {
    return {
      channel: 'telegram',
      accountId: 'main',
      chatType: 'group',
      peerId: '-1001234567890',
      senderId: '123456789',
      text: '/buildroom status',
      messageId: '10',
      mentionedBot: true,
      raw: {},
      ...overrides,
    };
  }
});
