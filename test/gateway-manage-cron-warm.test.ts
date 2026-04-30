import { describe, expect, it, vi } from 'vitest';

const { queryMock, startupMock, createSdkMcpServerMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  startupMock: vi.fn(),
  createSdkMcpServerMock: vi.fn((spec) => spec),
}));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: queryMock,
  startup: startupMock,
  createSdkMcpServer: createSdkMcpServerMock,
}));

import { Gateway } from '../src/gateway.js';

describe('Gateway manage_cron warm query handling', () => {
  it('does not prewarm agents that expose manage_cron', async () => {
    const gateway = new Gateway() as any;
    gateway.sdkReady = true;
    gateway.warmQueries = {
      discard: vi.fn(),
      prewarm: vi.fn(),
    };

    await gateway.prewarmAgent({
      id: 'example',
      config: { mcp_tools: ['manage_cron'] },
    });

    expect(gateway.warmQueries.discard).toHaveBeenCalledWith('example');
    expect(gateway.warmQueries.prewarm).not.toHaveBeenCalled();
  });

  it('bypasses stale warm query handles when useWarmQuery is false', () => {
    const coldQuery = { kind: 'cold-query' };
    queryMock.mockReturnValue(coldQuery);
    const gateway = new Gateway() as any;
    gateway.warmQueries = {
      discard: vi.fn(),
      take: vi.fn(),
    };
    const agent = { id: 'example' };

    const result = gateway.startQuery(agent, 'hello', { model: 'claude-sonnet-4-6' }, undefined, false);

    expect(result).toBe(coldQuery);
    expect(gateway.warmQueries.discard).toHaveBeenCalledWith('example');
    expect(gateway.warmQueries.take).not.toHaveBeenCalled();
    expect(queryMock).toHaveBeenCalledWith({
      prompt: 'hello',
      options: { model: 'claude-sonnet-4-6' },
    });
  });
});
