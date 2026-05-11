import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { observeHonchoTurn } from '../src/ingest.js';
import { resolveConfig } from '../src/config.js';

describe('Honcho turn ingestion', () => {
  it('creates peers/session and adds sanitized turn messages in order', async () => {
    const sdk = createSdk();

    await observeHonchoTurn({
      sdk,
      config: resolveConfig({}, { enabled: true, mode: 'observe' }),
      agentId: 'amina',
      sessionKey: 'amina:telegram:dm:123',
      payload: {
        channel: 'telegram',
        accountId: 'main',
        peerId: '123',
        senderId: '123',
        chatType: 'dm',
        newMessages: [
          { role: 'user', content: 'hello token=abcdefghijklmnopqrstuvwxyz1234567890' },
          { role: 'assistant', content: 'hi there' },
        ],
      },
    });

    expect(sdk.peer).toHaveBeenCalledTimes(2);
    expect(sdk.session).toHaveBeenCalledOnce();
    expect(sdk.sessionRecord.addPeers).toHaveBeenCalledWith([
      sdk.peers.get('user')!.peer,
      sdk.peers.get('agent')!.peer,
    ]);
    expect(sdk.sessionRecord.addMessages).toHaveBeenCalledWith([
      { peerId: expect.stringMatching(/^user:telegram:main:[a-f0-9]{24}$/), text: 'hello token=abcdef****7890' },
      { peerId: 'agent:amina', text: 'hi there' },
    ]);
  });

  it('does nothing when Honcho is disabled or mode is off', async () => {
    const sdk = createSdk();

    await observeHonchoTurn({
      sdk,
      config: resolveConfig({}, { enabled: false, mode: 'observe' }),
      agentId: 'amina',
      sessionKey: 's1',
      payload: minimalPayload(),
    });
    await observeHonchoTurn({
      sdk,
      config: resolveConfig({}, { enabled: true, mode: 'off' }),
      agentId: 'amina',
      sessionKey: 's1',
      payload: minimalPayload(),
    });

    expect(sdk.peer).not.toHaveBeenCalled();
    expect(sdk.session).not.toHaveBeenCalled();
  });

  it('queues failed writes when queue_on_failure is enabled', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'honcho-ingest-'));
    const queuePath = join(dir, 'queue.jsonl');
    const sdk = createSdk();
    sdk.sessionRecord.addMessages.mockRejectedValueOnce(new Error('network token=abcdefghijklmnopqrstuvwxyz1234567890'));

    await observeHonchoTurn({
      sdk,
      config: resolveConfig({}, { enabled: true, observe: { queue_on_failure: true } }),
      agentId: 'amina',
      sessionKey: 's1',
      payload: minimalPayload(),
      offlineQueuePath: queuePath,
    });

    const rows = readFileSync(queuePath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      agentId: 'amina',
      sessionKey: 's1',
      error: 'network token=abcdef****7890',
    });
  });
});

function minimalPayload(): Record<string, unknown> {
  return {
    channel: 'telegram',
    accountId: 'main',
    peerId: '123',
    senderId: '123',
    chatType: 'dm',
    newMessages: [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ],
  };
}

function createSdk() {
  const peers = new Map<string, { id: string; peer: { id: string; message: ReturnType<typeof vi.fn> } }>();
  const sessionRecord = {
    addPeers: vi.fn(async () => undefined),
    addMessages: vi.fn(async () => undefined),
  };
  const sdk = {
    peers,
    sessionRecord,
    peer: vi.fn(async (id: string) => {
      const kind = id.startsWith('agent:') ? 'agent' : 'user';
      const peer = {
        id,
        message: vi.fn((text: string) => ({ peerId: id, text })),
      };
      peers.set(kind, { id, peer });
      return peer;
    }),
    session: vi.fn(async () => sessionRecord),
  };
  return sdk;
}
