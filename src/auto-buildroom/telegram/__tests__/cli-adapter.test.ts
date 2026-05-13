import { describe, expect, it } from 'vitest';
import type {
  TelegramBuildroomCommand,
  TelegramBuildroomCommandAuthorization,
} from '../operator-command.js';
import { telegramBuildroomCommandToCliArgs } from '../cli-adapter.js';

describe('Telegram Buildroom CLI adapter', () => {
  it('maps authorized Telegram approval commands to canonical CLI args', () => {
    expect(telegramBuildroomCommandToCliArgs(okCommand('approve', ['review_20260512_docs']), {
      projectRoot: '/repo',
      roomId: 'anthroclaw-core',
    })).toEqual([
      'approve',
      'review_20260512_docs',
      '--root',
      '/repo',
      '--room',
      'anthroclaw-core',
      '--operator',
      'telegram_user:123456789',
      '--operator-route',
      'telegram_chat:-1001234567890',
    ]);
  });

  it('maps authorized Telegram build commands to explicit CLI execution', () => {
    expect(telegramBuildroomCommandToCliArgs(okCommand('build', ['approval_20260512_docs']), {
      projectRoot: '/repo',
      roomId: 'anthroclaw-core',
    })).toEqual([
      'build',
      'approval_20260512_docs',
      '--execute',
      '--root',
      '/repo',
      '--room',
      'anthroclaw-core',
      '--operator',
      'telegram_user:123456789',
      '--operator-route',
      'telegram_chat:-1001234567890',
    ]);
  });

  function okCommand(
    command: TelegramBuildroomCommand,
    args: string[],
  ): TelegramBuildroomCommandAuthorization & { ok: true } {
    return {
      ok: true,
      command,
      args,
      operatorId: 'telegram_user:123456789',
      route: 'telegram_chat:-1001234567890',
      sourceThread: null,
    };
  }
});
