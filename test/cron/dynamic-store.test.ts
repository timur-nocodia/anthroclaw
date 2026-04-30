import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DynamicCronStore } from '../../src/cron/dynamic-store.js';

describe('DynamicCronStore', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  function makePath(): string {
    tmpDir = mkdtempSync(join(tmpdir(), 'dyncron-test-'));
    return join(tmpDir, 'dynamic-cron.json');
  }

  it('creates and lists jobs', () => {
    const store = new DynamicCronStore(makePath());
    store.create({ id: 'morning', agentId: 'bot', schedule: '0 9 * * *', prompt: 'Good morning', enabled: true });
    store.create({ id: 'evening', agentId: 'bot', schedule: '0 21 * * *', prompt: 'Good evening', enabled: true });

    const jobs = store.list('bot');
    expect(jobs).toHaveLength(2);
    expect(jobs[0].id).toBe('morning');
    expect(jobs[1].id).toBe('evening');
  });

  it('filters by agentId', () => {
    const store = new DynamicCronStore(makePath());
    store.create({ id: 'j1', agentId: 'bot-a', schedule: '* * * * *', prompt: 'a', enabled: true });
    store.create({ id: 'j2', agentId: 'bot-b', schedule: '* * * * *', prompt: 'b', enabled: true });

    expect(store.list('bot-a')).toHaveLength(1);
    expect(store.list('bot-b')).toHaveLength(1);
    expect(store.list('bot-c')).toHaveLength(0);
  });

  it('prevents duplicate IDs for same agent', () => {
    const store = new DynamicCronStore(makePath());
    store.create({ id: 'job1', agentId: 'bot', schedule: '* * * * *', prompt: 'test', enabled: true });

    expect(() => {
      store.create({ id: 'job1', agentId: 'bot', schedule: '* * * * *', prompt: 'test2', enabled: true });
    }).toThrow('already exists');
  });

  it('deletes jobs', () => {
    const store = new DynamicCronStore(makePath());
    store.create({ id: 'to-delete', agentId: 'bot', schedule: '* * * * *', prompt: 'bye', enabled: true });

    expect(store.delete('bot', 'to-delete')).toBe(true);
    expect(store.list('bot')).toHaveLength(0);
    expect(store.delete('bot', 'nonexistent')).toBe(false);
  });

  it('toggles jobs', () => {
    const store = new DynamicCronStore(makePath());
    store.create({ id: 'toggle-me', agentId: 'bot', schedule: '* * * * *', prompt: 'test', enabled: true });

    expect(store.toggle('bot', 'toggle-me', false)).toBe(true);
    expect(store.list('bot')[0].enabled).toBe(false);

    expect(store.toggle('bot', 'toggle-me', true)).toBe(true);
    expect(store.list('bot')[0].enabled).toBe(true);

    expect(store.toggle('bot', 'nonexistent', true)).toBe(false);
  });

  it('persists across instances', () => {
    const path = makePath();
    const store1 = new DynamicCronStore(path);
    const expiresAt = Date.parse('2026-05-01T00:00:00.000Z');
    store1.create({
      id: 'persistent',
      agentId: 'bot',
      schedule: '0 12 * * *',
      prompt: 'lunch',
      deliverTo: {
        channel: 'telegram',
        peer_id: '48705953',
        account_id: 'content_sm',
        thread_id: 'topic-1',
      },
      createdBy: {
        channel: 'telegram',
        sender_id: '48705953',
        peer_id: '48705953',
        account_id: 'content_sm',
        thread_id: 'topic-1',
      },
      runOnce: true,
      expiresAt,
      enabled: true,
    });

    const store2 = new DynamicCronStore(path);
    const jobs = store2.list('bot');
    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toBe('persistent');
    expect(jobs[0].prompt).toBe('lunch');
    expect(jobs[0]).toMatchObject({
      deliverTo: {
        channel: 'telegram',
        peer_id: '48705953',
        account_id: 'content_sm',
        thread_id: 'topic-1',
      },
      createdBy: {
        channel: 'telegram',
        sender_id: '48705953',
        peer_id: '48705953',
        account_id: 'content_sm',
        thread_id: 'topic-1',
      },
      runOnce: true,
      expiresAt,
    });
  });

  it('getAll returns all jobs', () => {
    const store = new DynamicCronStore(makePath());
    store.create({ id: 'a', agentId: 'x', schedule: '* * * * *', prompt: '1', enabled: true });
    store.create({ id: 'b', agentId: 'y', schedule: '* * * * *', prompt: '2', enabled: true });

    expect(store.getAll()).toHaveLength(2);
  });

  it('handles missing file gracefully', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'dyncron-test-'));
    const store = new DynamicCronStore(join(tmpDir, 'nonexistent', 'cron.json'));
    expect(store.list('any')).toHaveLength(0);
  });
});
