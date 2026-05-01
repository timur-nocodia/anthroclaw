import { describe, it, expect } from 'vitest';
import { createPeerPauseTool, type PauseEntryShape, type PauseStoreLike } from '../src/tools/peer-pause.js';
import { resolveConfig } from '../src/config.js';

function makeFakePauseStore(): PauseStoreLike & { _entries: PauseEntryShape[] } {
  const entries: PauseEntryShape[] = [];
  return {
    _entries: entries,
    pause(agentId, peerKey, opts) {
      // Drop any existing entry for the same key to mirror real store semantics.
      for (let i = entries.length - 1; i >= 0; i--) {
        if (entries[i].agentId === agentId && entries[i].peerKey === peerKey) {
          entries.splice(i, 1);
        }
      }
      const now = new Date('2026-05-01T00:00:00Z');
      const expiresAt =
        opts.ttlMinutes === undefined
          ? null
          : new Date(now.getTime() + opts.ttlMinutes * 60_000).toISOString();
      const entry: PauseEntryShape = {
        agentId,
        peerKey,
        pausedAt: now.toISOString(),
        expiresAt,
        reason: opts.reason,
        source: opts.source,
        extendedCount: 0,
        lastOperatorMessageAt: now.toISOString(),
      };
      entries.push(entry);
      return entry;
    },
    unpause(agentId, peerKey) {
      const idx = entries.findIndex(
        (e) => e.agentId === agentId && e.peerKey === peerKey,
      );
      if (idx === -1) return null;
      const [removed] = entries.splice(idx, 1);
      return removed;
    },
    isPaused(agentId, peerKey) {
      const entry = entries.find(
        (e) => e.agentId === agentId && e.peerKey === peerKey,
      );
      if (!entry) return { paused: false };
      return { paused: true, entry, expired: false };
    },
    list(agentId) {
      return entries.filter((e) => !agentId || e.agentId === agentId);
    },
  };
}

const mockCtx = (overrides: Partial<{ agentId: string }> = {}) => ({
  agentId: overrides.agentId ?? 'klavdia',
});

const samplePeer = {
  channel: 'whatsapp' as const,
  account_id: 'business',
  peer_id: '37120@s.whatsapp.net',
};

function parsed(result: { content: Array<{ text: string }> }): Record<string, unknown> {
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

describe('operator_console.peer_pause', () => {
  it('action=pause sets a TTL pause and returns expires_at', async () => {
    const store = makeFakePauseStore();
    const tool = createPeerPauseTool({
      pauseStore: store,
      config: resolveConfig({ enabled: true, manages: ['amina'] }),
    });
    const r = await tool.handler(
      {
        target_agent_id: 'amina',
        peer: samplePeer,
        action: 'pause',
        ttl_minutes: 60,
      },
      mockCtx(),
    );
    const body = parsed(r);
    expect(body.ok).toBe(true);
    expect(body.action).toBe('pause');
    expect(typeof body.expires_at).toBe('string');
    expect(body.peer_key).toBe('whatsapp:business:37120@s.whatsapp.net');
    expect(body.reason).toBe('manual');
    expect(store.list('amina')).toHaveLength(1);
  });

  it('action=pause with ttl_minutes=null produces indefinite pause (manual_indefinite)', async () => {
    const store = makeFakePauseStore();
    const tool = createPeerPauseTool({
      pauseStore: store,
      config: resolveConfig({ enabled: true, manages: ['amina'] }),
    });
    const r = await tool.handler(
      {
        target_agent_id: 'amina',
        peer: samplePeer,
        action: 'pause',
        ttl_minutes: null,
      },
      mockCtx(),
    );
    const body = parsed(r);
    expect(body.ok).toBe(true);
    expect(body.expires_at).toBeNull();
    expect(body.reason).toBe('manual_indefinite');
  });

  it('action=unpause removes a previously-set pause and reports was_paused=true', async () => {
    const store = makeFakePauseStore();
    const tool = createPeerPauseTool({
      pauseStore: store,
      config: resolveConfig({ enabled: true, manages: ['amina'] }),
    });
    await tool.handler(
      { target_agent_id: 'amina', peer: samplePeer, action: 'pause', ttl_minutes: 30 },
      mockCtx(),
    );
    const r = await tool.handler(
      { target_agent_id: 'amina', peer: samplePeer, action: 'unpause' },
      mockCtx(),
    );
    const body = parsed(r);
    expect(body.ok).toBe(true);
    expect(body.was_paused).toBe(true);
    expect(store.list('amina')).toHaveLength(0);
  });

  it('action=unpause on missing entry reports was_paused=false', async () => {
    const store = makeFakePauseStore();
    const tool = createPeerPauseTool({
      pauseStore: store,
      config: resolveConfig({ enabled: true, manages: ['amina'] }),
    });
    const r = await tool.handler(
      { target_agent_id: 'amina', peer: samplePeer, action: 'unpause' },
      mockCtx(),
    );
    expect(parsed(r).was_paused).toBe(false);
  });

  it('action=list returns all entries for the target agent', async () => {
    const store = makeFakePauseStore();
    const tool = createPeerPauseTool({
      pauseStore: store,
      config: resolveConfig({ enabled: true, manages: ['amina'] }),
    });
    await tool.handler(
      {
        target_agent_id: 'amina',
        peer: { ...samplePeer, peer_id: 'peer1' },
        action: 'pause',
        ttl_minutes: 10,
      },
      mockCtx(),
    );
    await tool.handler(
      {
        target_agent_id: 'amina',
        peer: { ...samplePeer, peer_id: 'peer2' },
        action: 'pause',
        ttl_minutes: 10,
      },
      mockCtx(),
    );
    const r = await tool.handler(
      { target_agent_id: 'amina', peer: samplePeer, action: 'list' },
      mockCtx(),
    );
    const body = parsed(r);
    expect(Array.isArray(body.pauses)).toBe(true);
    expect((body.pauses as unknown[]).length).toBe(2);
  });

  it('action=status returns the gateway pause-store result', async () => {
    const store = makeFakePauseStore();
    const tool = createPeerPauseTool({
      pauseStore: store,
      config: resolveConfig({ enabled: true, manages: ['amina'] }),
    });
    await tool.handler(
      { target_agent_id: 'amina', peer: samplePeer, action: 'pause', ttl_minutes: 10 },
      mockCtx(),
    );
    const r = await tool.handler(
      { target_agent_id: 'amina', peer: samplePeer, action: 'status' },
      mockCtx(),
    );
    const body = parsed(r);
    expect(body.paused).toBe(true);
    expect(body.peer_key).toBe('whatsapp:business:37120@s.whatsapp.net');
  });

  it('rejects unmanaged target agent with "not authorized"', async () => {
    const store = makeFakePauseStore();
    const tool = createPeerPauseTool({
      pauseStore: store,
      config: resolveConfig({ enabled: true, manages: ['amina'] }),
    });
    const r = await tool.handler(
      { target_agent_id: 'larry', peer: samplePeer, action: 'pause', ttl_minutes: 5 },
      mockCtx(),
    );
    const body = parsed(r);
    expect(body.error).toMatch(/not authorized/i);
    expect(store.list()).toHaveLength(0);
  });

  it('rejects when the plugin is disabled', async () => {
    const tool = createPeerPauseTool({
      pauseStore: makeFakePauseStore(),
      config: resolveConfig({ enabled: false, manages: '*' }),
    });
    const r = await tool.handler(
      { target_agent_id: 'amina', peer: samplePeer, action: 'pause', ttl_minutes: 5 },
      mockCtx(),
    );
    expect(parsed(r).error).toMatch(/not authorized/i);
  });

  it('falls back gracefully when no pauseStore is bound', async () => {
    const tool = createPeerPauseTool({
      pauseStore: null,
      config: resolveConfig({ enabled: true, manages: ['amina'] }),
    });
    const r = await tool.handler(
      { target_agent_id: 'amina', peer: samplePeer, action: 'pause', ttl_minutes: 5 },
      mockCtx(),
    );
    expect(parsed(r).error).toMatch(/pause store unavailable/i);
  });

  it('manages: "*" allows any target', async () => {
    const store = makeFakePauseStore();
    const tool = createPeerPauseTool({
      pauseStore: store,
      config: resolveConfig({ enabled: true, manages: '*' }),
    });
    const r = await tool.handler(
      { target_agent_id: 'random-agent', peer: samplePeer, action: 'pause', ttl_minutes: 1 },
      mockCtx(),
    );
    expect(parsed(r).ok).toBe(true);
  });
});
