import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Gateway } from '../gateway.js';
import type { ChannelAdapter, InboundMessage, SendOptions } from '../channels/types.js';
import {
  initializeBuildroomStorage,
  saveBuildroomRoomConfig,
} from '../auto-buildroom/storage/init.js';

describe('Gateway Telegram Buildroom commands', () => {
  it('handles /buildroom commands before ordinary agent routing', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'anthroclaw-buildroom-gateway-'));
    const dataDir = join(projectRoot, 'data');
    mkdirSync(dataDir, { recursive: true });
    const initialized = initializeBuildroomStorage({
      projectRoot,
      operatorId: 'telegram_user:48705953',
    });
    initialized.config.operators[0].commandRoutes = ['telegram_chat:-1003931616911'];
    saveBuildroomRoomConfig(projectRoot, initialized.config);

    const sent: Array<{ peerId: string; text: string; opts?: SendOptions }> = [];
    const gw = new Gateway() as unknown as {
      dataDir: string;
      _setChannel(id: string, adapter: ChannelAdapter): void;
      dispatch(msg: InboundMessage): Promise<void>;
    };
    gw.dataDir = dataDir;
    gw._setChannel('telegram', channelAdapter(sent));

    await gw.dispatch(message());

    expect(sent).toHaveLength(1);
    expect(sent[0].peerId).toBe('-1003931616911');
    expect(sent[0].text).toContain('Buildroom: anthroclaw-core');
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

  function channelAdapter(
    sent: Array<{ peerId: string; text: string; opts?: SendOptions }>,
  ): ChannelAdapter {
    return {
      id: 'telegram',
      supportsApproval: true,
      start: async () => {},
      stop: async () => {},
      onMessage: () => {},
      sendText: async (peerId, text, opts) => {
        sent.push({ peerId, text, opts });
        return 'sent_1';
      },
      editText: async () => {},
      sendMedia: async () => 'sent_media_1',
      sendTyping: async () => {},
      promptForApproval: async () => {},
    };
  }
});
