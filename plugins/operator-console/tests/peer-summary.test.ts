import { describe, it, expect, vi } from 'vitest';
import { createPeerSummaryTool } from '../src/tools/peer-summary.js';
import { resolveConfig } from '../src/config.js';
import type { SearchAgentMemoryInput, SearchAgentMemoryResult } from '../src/types-shim.js';

const ctx = () => ({ agentId: 'klavdia' });

const samplePeer = {
  channel: 'whatsapp' as const,
  account_id: 'business',
  peer_id: '37120@s.whatsapp.net',
};

function parsed(result: { content: Array<{ text: string }> }): Record<string, unknown> {
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

describe('operator_console.peer_summary', () => {
  it('forwards query terms (peer info + extra query) to searchAgentMemory', async () => {
    const calls: SearchAgentMemoryInput[] = [];
    const fn = vi.fn(
      async (input: SearchAgentMemoryInput): Promise<SearchAgentMemoryResult> => {
        calls.push(input);
        return {
          results: [
            { path: 'memo.md#L1-L5', snippet: 'remembered detail', score: 0.8 },
          ],
        };
      },
    );
    const tool = createPeerSummaryTool({
      searchAgentMemory: fn,
      config: resolveConfig({ enabled: true, manages: ['amina'] }),
    });
    const r = await tool.handler(
      {
        target_agent_id: 'amina',
        peer: samplePeer,
        query: 'preferred meeting time',
        max_results: 3,
      },
      ctx(),
    );
    const body = parsed(r);
    expect(body.ok).toBe(true);
    expect(body.peer_key).toBe('whatsapp:business:37120@s.whatsapp.net');
    expect(Array.isArray(body.results)).toBe(true);
    expect((body.results as unknown[]).length).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].targetAgentId).toBe('amina');
    expect(calls[0].maxResults).toBe(3);
    expect(calls[0].query).toContain('preferred meeting time');
    expect(calls[0].query).toContain('37120@s.whatsapp.net');
    expect(calls[0].query).toContain('whatsapp');
  });

  it('returns empty results with explanatory note when no memory adapter is wired', async () => {
    const tool = createPeerSummaryTool({
      searchAgentMemory: null,
      config: resolveConfig({ enabled: true, manages: ['amina'] }),
    });
    const r = await tool.handler(
      { target_agent_id: 'amina', peer: samplePeer },
      ctx(),
    );
    const body = parsed(r);
    expect(body.ok).toBe(true);
    expect(body.results).toEqual([]);
    expect(body.notes).toMatch(/memory adapter not available/i);
  });

  it('rejects unmanaged target', async () => {
    const fn = vi.fn();
    const tool = createPeerSummaryTool({
      searchAgentMemory: fn,
      config: resolveConfig({ enabled: true, manages: ['amina'] }),
    });
    const r = await tool.handler(
      { target_agent_id: 'larry', peer: samplePeer },
      ctx(),
    );
    expect(parsed(r).error).toMatch(/not authorized/i);
    expect(fn).not.toHaveBeenCalled();
  });

  it('uses default max_results=10 when omitted', async () => {
    const calls: SearchAgentMemoryInput[] = [];
    const tool = createPeerSummaryTool({
      searchAgentMemory: async (input) => {
        calls.push(input);
        return { results: [] };
      },
      config: resolveConfig({ enabled: true, manages: ['amina'] }),
    });
    await tool.handler(
      { target_agent_id: 'amina', peer: samplePeer },
      ctx(),
    );
    expect(calls[0].maxResults).toBe(10);
  });
});
