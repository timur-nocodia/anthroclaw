import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { FileSessionStore } from '../../src/sdk/session-store.js';

describe('FileSessionStore', () => {
  it('appends, loads, lists, and deletes main session transcripts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openclaw-sdk-store-'));
    const store = new FileSessionStore(root);
    const key = { projectKey: '/tmp/project', sessionId: 'session-1' };

    try {
      await store.append(key, [
        { type: 'user', uuid: 'u1', timestamp: '2026-04-22T00:00:00.000Z', message: { text: 'hi' } },
      ]);
      await store.append(key, [
        { type: 'assistant', uuid: 'a1', timestamp: '2026-04-22T00:00:01.000Z', message: { text: 'hello' } },
      ]);

      await expect(store.load(key)).resolves.toEqual([
        { type: 'user', uuid: 'u1', timestamp: '2026-04-22T00:00:00.000Z', message: { text: 'hi' } },
        { type: 'assistant', uuid: 'a1', timestamp: '2026-04-22T00:00:01.000Z', message: { text: 'hello' } },
      ]);

      await expect(store.listSessions('/tmp/project')).resolves.toEqual([
        expect.objectContaining({ sessionId: 'session-1' }),
      ]);

      await store.delete(key);
      await expect(store.load(key)).resolves.toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('round-trips subagent transcript subpaths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openclaw-sdk-store-'));
    const store = new FileSessionStore(root);
    const key = {
      projectKey: '/tmp/project',
      sessionId: 'session-1',
      subpath: 'subagents/agent-sub-1.jsonl',
    };

    try {
      await store.append(key, [
        { type: 'assistant', uuid: 'sub-a1', timestamp: '2026-04-22T00:00:00.000Z' },
      ]);

      await expect(store.load(key)).resolves.toEqual([
        { type: 'assistant', uuid: 'sub-a1', timestamp: '2026-04-22T00:00:00.000Z' },
      ]);
      await expect(store.listSubkeys({ projectKey: '/tmp/project', sessionId: 'session-1' }))
        .resolves.toEqual(['subagents/agent-sub-1.jsonl']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('returns null or empty lists for missing data', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openclaw-sdk-store-'));
    const store = new FileSessionStore(root);

    try {
      await expect(store.load({ projectKey: 'missing', sessionId: 'none' })).resolves.toBeNull();
      await expect(store.listSessions('missing')).resolves.toEqual([]);
      await expect(store.listSubkeys({ projectKey: 'missing', sessionId: 'none' })).resolves.toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
