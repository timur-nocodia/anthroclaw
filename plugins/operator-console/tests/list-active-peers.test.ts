import { describe, it, expect } from 'vitest';
import { createListActivePeersTool } from '../src/tools/list-active-peers.js';
import { resolveConfig } from '../src/config.js';
import type { PauseEntryShape, PauseStoreLike } from '../src/tools/peer-pause.js';

function makeStore(entries: PauseEntryShape[]): PauseStoreLike {
  return {
    pause() {
      throw new Error('not used');
    },
    unpause() {
      throw new Error('not used');
    },
    isPaused() {
      throw new Error('not used');
    },
    list(agentId) {
      return entries.filter((e) => !agentId || e.agentId === agentId);
    },
  };
}

function entry(partial: Partial<PauseEntryShape>): PauseEntryShape {
  return {
    agentId: 'amina',
    peerKey: 'whatsapp:business:1',
    pausedAt: '2026-05-01T00:00:00Z',
    expiresAt: '2026-05-01T01:00:00Z',
    reason: 'manual',
    source: 'mcp:operator-console',
    extendedCount: 0,
    lastOperatorMessageAt: '2026-05-01T00:00:00Z',
    ...partial,
  };
}

const ctx = () => ({ agentId: 'klavdia' });

function parsed(result: { content: Array<{ text: string }> }): Record<string, unknown> {
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

describe('operator_console.list_active_peers', () => {
  it('returns all entries for the target agent', async () => {
    const store = makeStore([
      entry({ peerKey: 'whatsapp:business:1' }),
      entry({ peerKey: 'whatsapp:business:2' }),
      entry({ agentId: 'larry', peerKey: 'whatsapp:business:3' }),
    ]);
    const tool = createListActivePeersTool({
      pauseStore: store,
      config: resolveConfig({ enabled: true, manages: ['amina'] }),
    });
    const r = await tool.handler({ target_agent_id: 'amina' }, ctx());
    const body = parsed(r);
    expect(body.ok).toBe(true);
    expect(body.count).toBe(2);
    expect((body.peers as PauseEntryShape[]).every((p) => p.agentId === 'amina')).toBe(true);
  });

  it('filters out entries older than `since`', async () => {
    const store = makeStore([
      entry({ peerKey: 'p1', pausedAt: '2026-04-01T00:00:00Z' }),
      entry({ peerKey: 'p2', pausedAt: '2026-05-15T00:00:00Z' }),
    ]);
    const tool = createListActivePeersTool({
      pauseStore: store,
      config: resolveConfig({ enabled: true, manages: ['amina'] }),
    });
    const r = await tool.handler(
      { target_agent_id: 'amina', since: '2026-05-01T00:00:00Z' },
      ctx(),
    );
    const body = parsed(r);
    expect(body.count).toBe(1);
    expect((body.peers as PauseEntryShape[])[0].peerKey).toBe('p2');
  });

  it('respects limit and reports truncated=true when over', async () => {
    const store = makeStore([
      entry({ peerKey: 'p1' }),
      entry({ peerKey: 'p2' }),
      entry({ peerKey: 'p3' }),
    ]);
    const tool = createListActivePeersTool({
      pauseStore: store,
      config: resolveConfig({ enabled: true, manages: ['amina'] }),
    });
    const r = await tool.handler(
      { target_agent_id: 'amina', limit: 2 },
      ctx(),
    );
    const body = parsed(r);
    expect(body.count).toBe(2);
    expect(body.truncated).toBe(true);
  });

  it('rejects unmanaged target', async () => {
    const tool = createListActivePeersTool({
      pauseStore: makeStore([]),
      config: resolveConfig({ enabled: true, manages: ['amina'] }),
    });
    const r = await tool.handler({ target_agent_id: 'larry' }, ctx());
    expect(parsed(r).error).toMatch(/not authorized/i);
  });

  it('returns empty list (count=0) when target has no entries', async () => {
    const store = makeStore([]);
    const tool = createListActivePeersTool({
      pauseStore: store,
      config: resolveConfig({ enabled: true, manages: ['amina'] }),
    });
    const r = await tool.handler({ target_agent_id: 'amina' }, ctx());
    const body = parsed(r);
    expect(body.count).toBe(0);
    expect(body.truncated).toBe(false);
    expect(body.peers).toEqual([]);
  });
});
