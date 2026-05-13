import { describe, expect, it } from 'vitest';
import { resolveTelegramBuildroomNotificationTargets } from '../notification.js';

describe('Telegram Buildroom notifications', () => {
  it('resolves configured Telegram notification routes into send targets', () => {
    expect(resolveTelegramBuildroomNotificationTargets([
      'telegram_chat:-1001234567890',
      'telegram_thread:-1001234567890:2',
      'cli:local',
      'telegram_thread:not-a-chat:2',
    ])).toEqual([
      {
        route: 'telegram_chat:-1001234567890',
        chatId: -1001234567890,
        messageThreadId: null,
      },
      {
        route: 'telegram_thread:-1001234567890:2',
        chatId: -1001234567890,
        messageThreadId: 2,
      },
    ]);
  });
});
