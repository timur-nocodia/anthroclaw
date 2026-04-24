import { describe, expect, it, vi, beforeEach } from 'vitest';

const { startupMock } = vi.hoisted(() => ({
  startupMock: vi.fn(),
}));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  startup: startupMock,
}));

import { WarmQueryPool } from '../../src/sdk/warm-pool.js';

describe('WarmQueryPool', () => {
  beforeEach(() => {
    startupMock.mockReset();
  });

  it('prewarms and consumes a single warm query handle', async () => {
    const handle = {
      query: vi.fn(),
      close: vi.fn(),
    };
    startupMock.mockResolvedValue(handle);

    const pool = new WarmQueryPool();
    await pool.prewarm('agent-a', { model: 'claude-sonnet-4-6' } as any);

    expect(startupMock).toHaveBeenCalledWith({
      options: { model: 'claude-sonnet-4-6' },
    });
    expect(pool.hasWarmQuery('agent-a')).toBe(true);
    expect(pool.take('agent-a')).toBe(handle);
    expect(pool.hasWarmQuery('agent-a')).toBe(false);
  });

  it('does not start duplicate prewarms for the same key', async () => {
    const handle = {
      query: vi.fn(),
      close: vi.fn(),
    };
    startupMock.mockResolvedValue(handle);

    const pool = new WarmQueryPool();
    await Promise.all([
      pool.prewarm('agent-a', {} as any),
      pool.prewarm('agent-a', {} as any),
    ]);

    expect(startupMock).toHaveBeenCalledTimes(1);
  });

  it('closes stored handles', async () => {
    const handle = {
      query: vi.fn(),
      close: vi.fn(),
    };
    startupMock.mockResolvedValue(handle);

    const pool = new WarmQueryPool();
    await pool.prewarm('agent-a', {} as any);
    pool.closeAll();

    expect(handle.close).toHaveBeenCalledTimes(1);
    expect(pool.hasWarmQuery('agent-a')).toBe(false);
  });
});
