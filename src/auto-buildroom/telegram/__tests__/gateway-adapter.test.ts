import { describe, expect, it } from 'vitest';
import type { InboundMessage, SendOptions } from '../../../channels/types.js';
import { createDefaultBuildroomConfig } from '../../config/model.js';
import { handleTelegramBuildroomGatewayMessage } from '../gateway-adapter.js';

describe('Telegram Buildroom gateway adapter', () => {
  it('handles slash commands by loading config, running CLI, and sending the result', async () => {
    const config = createDefaultBuildroomConfig({
      roomId: 'anthroclaw-core',
      operatorId: 'telegram_user:123456789',
    });
    config.operators[0].commandRoutes = ['telegram_thread:-1001234567890:2'];
    const cliCalls: string[][] = [];
    const sent: Array<{ peerId: string; text: string; opts?: SendOptions }> = [];

    const handled = await handleTelegramBuildroomGatewayMessage(message({
      threadId: '2',
    }), {
      projectRoot: '/repo',
      roomId: 'anthroclaw-core',
      loadConfig: async () => config,
      runCli: async (argv, io) => {
        cliCalls.push(argv);
        io.stdout('Buildroom: anthroclaw-core');
        return 0;
      },
      sendText: async (peerId, text, opts) => {
        sent.push({ peerId, text, opts });
      },
    });

    expect(handled).toBe(true);
    expect(cliCalls).toHaveLength(1);
    expect(sent).toEqual([{
      peerId: '-1001234567890',
      text: 'Buildroom: anthroclaw-core',
      opts: { accountId: 'main', threadId: '2' },
    }]);
  });

  it('uses the loaded config room id when no explicit room override is provided', async () => {
    const config = createDefaultBuildroomConfig({
      roomId: 'anthroclaw-core',
      operatorId: 'telegram_user:123456789',
    });
    config.operators[0].commandRoutes = ['telegram_chat:-1001234567890'];
    const cliCalls: string[][] = [];

    await handleTelegramBuildroomGatewayMessage(message(), {
      projectRoot: '/repo',
      loadConfig: async () => config,
      runCli: async (argv) => {
        cliCalls.push(argv);
        return 0;
      },
      sendText: async () => {},
    });

    expect(cliCalls[0]).toContain('anthroclaw-core');
  });

  it('does not route ordinary Telegram text through Buildroom', async () => {
    let loaded = false;
    const handled = await handleTelegramBuildroomGatewayMessage(message({ text: 'hello' }), {
      projectRoot: '/repo',
      roomId: 'anthroclaw-core',
      loadConfig: async () => {
        loaded = true;
        return null;
      },
      runCli: async () => 0,
      sendText: async () => {},
    });

    expect(handled).toBe(false);
    expect(loaded).toBe(false);
  });

  it('fails closed when a Buildroom command is received before config exists', async () => {
    const sent: string[] = [];

    const handled = await handleTelegramBuildroomGatewayMessage(message(), {
      projectRoot: '/repo',
      roomId: 'anthroclaw-core',
      loadConfig: async () => null,
      runCli: async () => {
        throw new Error('runCli should not be called');
      },
      sendText: async (_peerId, text) => {
        sent.push(text);
      },
    });

    expect(handled).toBe(true);
    expect(sent).toEqual([
      'Buildroom command rejected: Buildroom config is not initialized.',
    ]);
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
