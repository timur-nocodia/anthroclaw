import { describe, expect, it } from 'vitest';
import {
  buildHonchoSessionId,
  deriveHonchoPeers,
  hashStableId,
} from '../src/ids.js';
import { resolveConfig } from '../src/config.js';

describe('Honcho ID mapping', () => {
  it('hashes stable identifiers without leaking raw channel peer IDs', () => {
    const hashed = hashStableId('telegram:main:123456789');

    expect(hashed).toMatch(/^[a-f0-9]{24}$/);
    expect(hashed).not.toContain('123456789');
    expect(hashStableId('telegram:main:123456789')).toBe(hashed);
  });

  it('derives agent and user peers for a Telegram DM', () => {
    const peers = deriveHonchoPeers({
      agentId: 'amina',
      channel: 'telegram',
      accountId: 'main',
      chatType: 'dm',
      peerId: '123456789',
      senderId: '123456789',
      config: resolveConfig(),
    });

    expect(peers.agentPeerId).toBe('agent:amina');
    expect(peers.userPeerId).toMatch(/^user:telegram:main:[a-f0-9]{24}$/);
    expect(peers.userPeerId).not.toContain('123456789');
    expect(peers.groupPeerId).toBeUndefined();
  });

  it('includes a group peer for shared group sessions', () => {
    const peers = deriveHonchoPeers({
      agentId: 'sales',
      channel: 'whatsapp',
      accountId: 'main',
      chatType: 'group',
      peerId: '120363111@g.us',
      senderId: '77015550000@s.whatsapp.net',
      groupSessionMode: 'shared',
      config: resolveConfig(),
    });

    expect(peers.agentPeerId).toBe('agent:sales');
    expect(peers.userPeerId).toMatch(/^user:whatsapp:main:[a-f0-9]{24}$/);
    expect(peers.groupPeerId).toMatch(/^group:whatsapp:main:[a-f0-9]{24}$/);
    expect(peers.groupPeerId).not.toContain('120363111');
  });

  it('can intentionally use raw IDs when hash_ids is disabled', () => {
    const peers = deriveHonchoPeers({
      agentId: 'debug',
      channel: 'telegram',
      accountId: 'main',
      chatType: 'dm',
      peerId: '12345',
      senderId: '12345',
      config: resolveConfig({}, { peers: { hash_ids: false } }),
    });

    expect(peers.userPeerId).toBe('user:telegram:main:12345');
  });

  it('builds a stable hashed session ID from the AnthroClaw session key', () => {
    const sessionId = buildHonchoSessionId('amina:telegram:dm:123456789');

    expect(sessionId).toMatch(/^session:[a-f0-9]{24}$/);
    expect(sessionId).toBe(buildHonchoSessionId('amina:telegram:dm:123456789'));
    expect(sessionId).not.toContain('123456789');
  });
});
