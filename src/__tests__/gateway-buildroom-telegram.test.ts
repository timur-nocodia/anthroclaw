import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Gateway } from '../gateway.js';
import type { ChannelAdapter, InboundMessage, SendOptions } from '../channels/types.js';
import { FileArtifactStore } from '../auto-buildroom/artifacts/store.js';
import type { BuildroomArtifact } from '../auto-buildroom/artifacts/model.js';
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
      operatorId: 'telegram_user:123456789',
    });
    initialized.config.operators[0].commandRoutes = ['telegram_chat:-1001234567890'];
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
    expect(sent[0].peerId).toBe('-1001234567890');
    expect(sent[0].text).toContain('Buildroom: anthroclaw-core');
  });

  it('fans lifecycle notifications to configured Telegram notification routes', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'anthroclaw-buildroom-gateway-notify-'));
    const dataDir = join(projectRoot, 'data');
    mkdirSync(dataDir, { recursive: true });
    const initialized = initializeBuildroomStorage({
      projectRoot,
      operatorId: 'telegram_user:123456789',
    });
    initialized.config.operators[0].commandRoutes = ['telegram_chat:-1001234567890'];
    initialized.config.notifications.routes = ['telegram_thread:-1001234567890:2'];
    saveBuildroomRoomConfig(projectRoot, initialized.config);

    const store = new FileArtifactStore({ projectRoot, roomId: 'anthroclaw-core' });
    const build = store.writeArtifact(artifact('build_20260512_docs', 'coder_receipt', {
      runtimeStatus: 'completed',
      builderClaims: ['Updated operator guide.'],
      postRunPolicyResult: {
        allowed: true,
        changedFiles: [],
        violations: [],
      },
    }));
    store.writeArtifact({
      ...artifact('qa_20260512_docs', 'qa_report', {
        qaStatus: 'pass',
        evidence: [{ claim: 'Updated operator guide.', status: 'confirmed' }],
      }),
      parentIds: [build.id],
      inputRefs: [{ kind: 'artifact', ref: build.id }],
    });

    const sent: Array<{ peerId: string; text: string; opts?: SendOptions }> = [];
    const gw = new Gateway() as unknown as {
      dataDir: string;
      _setChannel(id: string, adapter: ChannelAdapter): void;
      dispatch(msg: InboundMessage): Promise<void>;
    };
    gw.dataDir = dataDir;
    gw._setChannel('telegram', channelAdapter(sent));

    await gw.dispatch(message({ text: '/buildroom trust build_20260512_docs' }));

    expect(sent).toHaveLength(2);
    const commandResponse = sent.find((message) => message.opts?.threadId == null);
    const notification = sent.find((message) => message.opts?.threadId === '2');
    expect(commandResponse).toMatchObject({
      peerId: '-1001234567890',
      opts: { accountId: 'main' },
    });
    expect(commandResponse?.text).toContain('Trust report: trust_20260512_docs');
    expect(notification).toMatchObject({
      peerId: '-1001234567890',
      opts: { accountId: 'main', threadId: '2' },
    });
    expect(notification?.text).toContain('Buildroom trust: CLEAN');
    expect(notification?.text).toContain('Notification only. Approval still requires explicit /buildroom commands.');
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

  function channelAdapter(
    sent: Array<{ peerId: string; text: string; opts?: SendOptions }>,
  ): ChannelAdapter {
    return {
      id: 'telegram',
      supportsApproval: true,
      approvalMode: 'interactive_buttons',
      start: async () => {},
      stop: async () => {},
      onMessage: () => {},
      sendText: async (peerId, text, opts) => {
        sent.push({ peerId, text, opts });
        return 'sent_1';
      },
      editText: async () => {},
      deleteText: async () => {},
      sendMedia: async () => 'sent_media_1',
      sendTyping: async () => {},
      promptForApproval: async () => {},
    };
  }

  function artifact(
    id: string,
    type: BuildroomArtifact['type'],
    payload: Record<string, unknown>,
  ): BuildroomArtifact {
    return {
      id,
      type,
      schemaVersion: 'auto-buildroom/v1',
      status: 'completed',
      createdAt: '2026-05-12T00:00:00.000Z',
      producer: { role: 'test', runId: `run_${id}` },
      room: { id: 'anthroclaw-core' },
      parentIds: [],
      inputRefs: [],
      outputRefs: [],
      runtimeRefs: [],
      traceId: 'trace_20260512_docs',
      redaction: {
        rawTranscriptsIncluded: false,
        secretsRedacted: true,
        redactedFields: [],
      },
      contentHash: '',
      payload,
    };
  }
});
