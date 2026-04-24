import { describe, expect, it, vi } from 'vitest';
import { SdkCheckpointRegistry } from '../../src/sdk/checkpoints.js';

function mockQuery(result = { canRewind: true, filesChanged: ['a.ts'], insertions: 1, deletions: 2 }) {
  return {
    rewindFiles: vi.fn(async () => result),
  } as any;
}

describe('SdkCheckpointRegistry', () => {
  it('rewinds files through a registered SDK Query handle', async () => {
    const registry = new SdkCheckpointRegistry();
    const query = mockQuery();

    registry.register(['session-1'], query);

    await expect(registry.rewindFiles({
      sessionId: 'session-1',
      userMessageId: 'msg-1',
      dryRun: true,
    })).resolves.toEqual({
      sessionId: 'session-1',
      userMessageId: 'msg-1',
      canRewind: true,
      filesChanged: ['a.ts'],
      insertions: 1,
      deletions: 2,
    });
    expect(query.rewindFiles).toHaveBeenCalledWith('msg-1', { dryRun: true });
  });

  it('supports aliases for the same query handle', async () => {
    const registry = new SdkCheckpointRegistry();
    const query = mockQuery();

    registry.register(['web:agent:temp'], query);
    registry.alias('sdk-session-1', 'web:agent:temp');

    await registry.rewindFiles({
      sessionId: 'sdk-session-1',
      userMessageId: 'msg-1',
    });

    expect(query.rewindFiles).toHaveBeenCalledWith('msg-1', { dryRun: undefined });
  });

  it('returns a structured error when no control handle is available', async () => {
    const registry = new SdkCheckpointRegistry();

    await expect(registry.rewindFiles({
      sessionId: 'missing',
      userMessageId: 'msg-1',
    })).resolves.toMatchObject({
      sessionId: 'missing',
      userMessageId: 'msg-1',
      canRewind: false,
    });
  });

  it('expires old handles', async () => {
    let now = 1000;
    const registry = new SdkCheckpointRegistry({
      ttlMs: 100,
      now: () => now,
    });

    registry.register(['session-1'], mockQuery());
    now = 1200;

    await expect(registry.rewindFiles({
      sessionId: 'session-1',
      userMessageId: 'msg-1',
    })).resolves.toMatchObject({
      canRewind: false,
    });
  });
});
