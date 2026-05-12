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
      'telegram_user:48705953',
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
      'telegram_user:48705953',
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
      operatorId: 'telegram_user:48705953',
      route: 'telegram_chat:-1003931616911',
      sourceThread: null,
    };
  }
});
