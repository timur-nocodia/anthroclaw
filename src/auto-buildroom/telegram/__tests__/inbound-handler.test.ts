import { describe, expect, it } from 'vitest';
import type { InboundMessage } from '../../../channels/types.js';
import { createDefaultBuildroomConfig } from '../../config/model.js';
import { handleTelegramBuildroomInboundMessage } from '../inbound-handler.js';

describe('Telegram Buildroom inbound handler', () => {
  it('routes Telegram Buildroom commands through the command handler boundary', async () => {
    const config = createDefaultBuildroomConfig({
      roomId: 'anthroclaw-core',
      operatorId: 'telegram_user:48705953',
    });
    config.operators[0].commandRoutes = ['telegram_chat:-1003931616911'];
    const calls: string[][] = [];

    const result = await handleTelegramBuildroomInboundMessage(config, message(), {
      projectRoot: '/repo',
      roomId: 'anthroclaw-core',
      runCli: async (argv, io) => {
        calls.push(argv);
        io.stdout('Buildroom: anthroclaw-core');
        return 0;
      },
    });

    expect(result).toMatchObject({
      handled: true,
      ok: true,
      exitCode: 0,
      text: 'Buildroom: anthroclaw-core',
    });
    expect(calls).toEqual([[
      'status',
      '--root',
      '/repo',
      '--room',
      'anthroclaw-core',
      '--operator',
      'telegram_user:48705953',
    ]]);
  });

  it('ignores non-Telegram messages before command authorization', async () => {
    const config = createDefaultBuildroomConfig({
      roomId: 'anthroclaw-core',
      operatorId: 'telegram_user:48705953',
    });
    let called = false;

    const result = await handleTelegramBuildroomInboundMessage(
      config,
      message({ channel: 'whatsapp' }),
      {
        projectRoot: '/repo',
        roomId: 'anthroclaw-core',
        runCli: async () => {
          called = true;
          return 0;
        },
      },
    );

    expect(result).toEqual({ handled: false });
    expect(called).toBe(false);
  });

  function message(overrides: Partial<InboundMessage> = {}): InboundMessage {
    return {
      channel: 'telegram',
      accountId: 'main',
      chatType: 'group',
      peerId: '-1003931616911',
      senderId: '48705953',
      text: '/buildroom status',
      messageId: '10',
      mentionedBot: true,
      raw: {},
      ...overrides,
    };
  }
});
