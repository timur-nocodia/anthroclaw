import { describe, it, expect, vi } from 'vitest';
import { createDelegateTool } from '../src/tools/delegate-to-peer.js';
import { resolveConfig } from '../src/config.js';
import type { SyntheticInboundInput, SyntheticInboundResult } from '../src/types-shim.js';

const mockCtx = () => ({ agentId: 'klavdia' });

const samplePeer = {
  channel: 'whatsapp' as const,
  account_id: 'business',
  peer_id: '37120@s.whatsapp.net',
};

function parsed(result: { content: Array<{ text: string }> }): Record<string, unknown> {
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

describe('operator_console.delegate_to_peer', () => {
  it('synthesises an inbound message wrapped with the operator-delegation prefix', async () => {
    const dispatched: SyntheticInboundInput[] = [];
    const fn = vi.fn(
      async (msg: SyntheticInboundInput): Promise<SyntheticInboundResult> => {
        dispatched.push(msg);
        return { messageId: 'msg-123', sessionKey: 'amina:whatsapp:dm:37120@s.whatsapp.net' };
      },
    );
    const tool = createDelegateTool({
      dispatchSynthetic: fn,
      config: resolveConfig({ enabled: true, manages: ['amina'] }),
    });
    const r = await tool.handler(
      {
        target_agent_id: 'amina',
        peer: samplePeer,
        instruction: 'find out a convenient time for a call',
      },
      mockCtx(),
    );

    const body = parsed(r);
    expect(body.ok).toBe(true);
    expect(body.dispatched_message_id).toBe('msg-123');
    expect(body.target_session_id).toBe('amina:whatsapp:dm:37120@s.whatsapp.net');
    expect(fn).toHaveBeenCalledOnce();
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].text).toContain('[Operator delegation]');
    expect(dispatched[0].text).toContain('find out a convenient time for a call');
    expect(dispatched[0].targetAgentId).toBe('amina');
    expect(dispatched[0].channel).toBe('whatsapp');
    expect(dispatched[0].peerId).toBe('37120@s.whatsapp.net');
  });

  it('rejects unmanaged target', async () => {
    const fn = vi.fn();
    const tool = createDelegateTool({
      dispatchSynthetic: fn,
      config: resolveConfig({ enabled: true, manages: ['amina'] }),
    });
    const r = await tool.handler(
      { target_agent_id: 'larry', peer: samplePeer, instruction: 'something' },
      mockCtx(),
    );
    expect(parsed(r).error).toMatch(/not authorized/i);
    expect(fn).not.toHaveBeenCalled();
  });

  it('returns an error when no dispatchSynthetic is wired', async () => {
    const tool = createDelegateTool({
      dispatchSynthetic: null,
      config: resolveConfig({ enabled: true, manages: ['amina'] }),
    });
    const r = await tool.handler(
      { target_agent_id: 'amina', peer: samplePeer, instruction: 'something' },
      mockCtx(),
    );
    expect(parsed(r).error).toMatch(/synthetic dispatch unavailable/i);
  });

  it('passes meta { source: "mcp:operator-console", delegation: true } in the synthetic payload', async () => {
    const dispatched: SyntheticInboundInput[] = [];
    const tool = createDelegateTool({
      dispatchSynthetic: async (msg) => {
        dispatched.push(msg);
        return { messageId: 'mid', sessionKey: 's' };
      },
      config: resolveConfig({ enabled: true, manages: ['amina'] }),
    });
    await tool.handler(
      { target_agent_id: 'amina', peer: samplePeer, instruction: 'x' },
      mockCtx(),
    );
    expect(dispatched[0].meta).toMatchObject({
      source: 'mcp:operator-console',
      delegation: true,
    });
  });
});
