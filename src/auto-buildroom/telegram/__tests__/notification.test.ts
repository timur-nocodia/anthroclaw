import { describe, expect, it } from 'vitest';
import { resolveTelegramBuildroomNotificationTargets } from '../notification.js';

describe('Telegram Buildroom notifications', () => {
  it('resolves configured Telegram notification routes into send targets', () => {
    expect(resolveTelegramBuildroomNotificationTargets([
      'telegram_chat:-1003931616911',
      'telegram_thread:-1003931616911:2',
      'cli:local',
      'telegram_thread:not-a-chat:2',
    ])).toEqual([
      {
        route: 'telegram_chat:-1003931616911',
        chatId: -1003931616911,
        messageThreadId: null,
      },
      {
        route: 'telegram_thread:-1003931616911:2',
        chatId: -1003931616911,
        messageThreadId: 2,
      },
    ]);
  });
});
