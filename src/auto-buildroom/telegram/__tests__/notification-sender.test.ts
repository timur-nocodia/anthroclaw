import { describe, expect, it } from 'vitest';
import { sendTelegramBuildroomNotification } from '../notification-sender.js';

describe('Telegram Buildroom notification sender', () => {
  it('fans out notification text to configured Telegram routes without authority semantics', async () => {
    const sent: Array<{ chatId: number; text: string; messageThreadId: number | null }> = [];

    await sendTelegramBuildroomNotification({
      routes: [
        'telegram_chat:-1001234567890',
        'telegram_thread:-1001234567890:2',
        'cli:local',
      ],
      text: 'Trust: WATCH\nNext: /buildroom report',
      sendText: async (target, text) => {
        sent.push({
          chatId: target.chatId,
          text,
          messageThreadId: target.messageThreadId,
        });
      },
    });

    expect(sent).toEqual([
      {
        chatId: -1001234567890,
        text: 'Trust: WATCH\nNext: /buildroom report',
        messageThreadId: null,
      },
      {
        chatId: -1001234567890,
        text: 'Trust: WATCH\nNext: /buildroom report',
        messageThreadId: 2,
      },
    ]);
  });
});
