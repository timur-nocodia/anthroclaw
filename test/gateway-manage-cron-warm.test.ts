import { describe, expect, it, vi } from 'vitest';

const { queryMock, startupMock, createSdkMcpServerMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  startupMock: vi.fn(),
  createSdkMcpServerMock: vi.fn((spec) => spec),
}));

vi.mock('@anthroclaw/legacy-claude-agent-sdk', () => ({
  claudeAgentHeadlessRuntime: { id: 'claude-agent-sdk', runText: vi.fn() },
  query: queryMock,
  startup: startupMock,
  createSdkMcpServer: createSdkMcpServerMock,
}));

import { Gateway } from '../src/gateway.js';

/**
 * v1.1.6 reversed the historical warm-query bypass for manage_cron agents.
 * The bypass (commit 9e650cf) was added defensively to avoid stale session
 * context bleed, but commit 117371b already routed peer/thread context
 * through AsyncLocalStorage at dispatch time — warm subprocesses are
 * session-agnostic. The bypass had a hidden cost: cron-having agents that
 * also use external HTTP MCP servers (Linear/Supabase) paid a fresh
 * handshake on every turn, which surfaced on 2026-05-16 as 8-min hangs on
 * a cron-heavy runtime fixture. This test locks the corrected behavior in place so a
 * future refactor doesn't silently bring the bypass back.
 */
describe('Gateway warm queries for manage_cron agents', () => {
  it('does not prewarm agents that use Pi Gateway runtime', async () => {
    const gateway = new Gateway() as any;
    gateway.sdkReady = true;
    gateway.warmQueries = {
      discard: vi.fn(),
      prewarm: vi.fn(),
    };

    await gateway.prewarmAgent({
      id: 'pi-agent',
      config: { runtime: { headless: { provider: 'pi' } } },
    });

    expect(gateway.warmQueries.discard).toHaveBeenCalledWith('pi-agent');
    expect(gateway.warmQueries.prewarm).not.toHaveBeenCalled();
  });

  it('PREWARMS agents that expose manage_cron (no special-case bypass)', async () => {
    const gateway = new Gateway() as any;
    gateway.sdkReady = true;
    gateway.warmQueries = {
      discard: vi.fn(),
      prewarm: vi.fn().mockResolvedValue(undefined),
    };
    gateway.buildUserQueryOptions = vi.fn().mockResolvedValue({
      model: 'claude-sonnet-4-6',
    });

    await gateway.prewarmAgent({
      id: 'cron-agent',
      config: { mcp_tools: ['manage_cron'] },
    });

    expect(gateway.warmQueries.discard).not.toHaveBeenCalled();
    expect(gateway.warmQueries.prewarm).toHaveBeenCalledWith('cron-agent', expect.any(Object));
  });

  it('TAKES a warm query for cron-having agents when one is available', () => {
    const warmHandle = { query: vi.fn().mockReturnValue({ kind: 'warm-result' }) };
    const gateway = new Gateway() as any;
    gateway.warmQueries = {
      take: vi.fn().mockReturnValue(warmHandle),
      prewarm: vi.fn().mockResolvedValue(undefined),
    };
    gateway.buildUserQueryOptions = vi.fn().mockResolvedValue({});
    const agent = {
      id: 'cron-agent',
      config: { mcp_tools: ['manage_cron'], external_mcp_servers: {} },
    };

    const result = gateway.startQuery(agent, 'hello', { model: 'claude-sonnet-4-6' });

    expect(gateway.warmQueries.take).toHaveBeenCalledWith('cron-agent');
    expect(warmHandle.query).toHaveBeenCalledWith('hello');
    expect(result).toEqual({ kind: 'warm-result' });
    // Cold-spawn must NOT be invoked when a warm handle exists.
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('falls back to cold spawn when resume is requested (warm cannot resume)', () => {
    const coldQuery = { kind: 'cold-query' };
    queryMock.mockReturnValue(coldQuery);
    const gateway = new Gateway() as any;
    gateway.warmQueries = {
      take: vi.fn(),
      prewarm: vi.fn().mockResolvedValue(undefined),
    };
    const agent = {
      id: 'cron-agent',
      config: { mcp_tools: ['manage_cron'], external_mcp_servers: {} },
    };

    const result = gateway.startQuery(agent, 'hello', { model: 'claude-sonnet-4-6' }, 'session-resume-id');

    expect(gateway.warmQueries.take).not.toHaveBeenCalled();
    expect(result).toBe(coldQuery);
    expect(queryMock).toHaveBeenCalledWith({
      prompt: 'hello',
      options: { model: 'claude-sonnet-4-6' },
    });
  });
});
