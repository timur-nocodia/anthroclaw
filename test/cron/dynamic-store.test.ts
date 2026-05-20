import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DynamicCronStore } from '../../src/cron/dynamic-store.js';
import type { DynamicCronJobInput } from '../../src/cron/dynamic-store.js';

describe('DynamicCronStore', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  function makePath(): string {
    tmpDir = mkdtempSync(join(tmpdir(), 'dyncron-test-'));
    return join(tmpDir, 'dynamic-cron.json');
  }

  function makeJob(overrides: Partial<DynamicCronJobInput> = {}): DynamicCronJobInput {
    return {
      id: 'job',
      agentId: 'bot',
      schedule: '* * * * *',
      prompt: 'test',
      deliverTo: { channel: 'telegram', peer_id: 'peer-1', account_id: 'default' },
      createdBy: { channel: 'telegram', sender_id: 'sender-1', peer_id: 'peer-1', account_id: 'default' },
      enabled: true,
      ...overrides,
    };
  }

  it('creates and lists jobs', () => {
    const store = new DynamicCronStore(makePath());
    store.create(makeJob({ id: 'morning', schedule: '0 9 * * *', prompt: 'Good morning' }));
    store.create(makeJob({ id: 'evening', schedule: '0 21 * * *', prompt: 'Good evening' }));

    const jobs = store.list('bot');
    expect(jobs).toHaveLength(2);
    expect(jobs[0].id).toBe('morning');
    expect(jobs[1].id).toBe('evening');
    expect(jobs[0]).toMatchObject({
      durable: true,
      runOnce: false,
      expiresAt: null,
      enabled: true,
    });
    expect(jobs[0].updatedAt).toBe(jobs[0].createdAt);
  });

  it('filters by agentId', () => {
    const store = new DynamicCronStore(makePath());
    store.create(makeJob({ id: 'j1', agentId: 'bot-a', prompt: 'a' }));
    store.create(makeJob({ id: 'j2', agentId: 'bot-b', prompt: 'b' }));

    expect(store.list('bot-a')).toHaveLength(1);
    expect(store.list('bot-b')).toHaveLength(1);
    expect(store.list('bot-c')).toHaveLength(0);
  });

  it('prevents duplicate IDs for same agent', () => {
    const store = new DynamicCronStore(makePath());
    store.create(makeJob({ id: 'job1' }));

    expect(() => {
      store.create(makeJob({ id: 'job1', prompt: 'test2' }));
    }).toThrow('already exists');
  });

  it('deletes jobs', () => {
    const store = new DynamicCronStore(makePath());
    store.create(makeJob({ id: 'to-delete', prompt: 'bye' }));

    expect(store.delete('bot', 'to-delete')).toBe(true);
    expect(store.list('bot')).toHaveLength(0);
    expect(store.delete('bot', 'nonexistent')).toBe(false);
  });

  it('toggles jobs', () => {
    const store = new DynamicCronStore(makePath());
    const created = store.create(makeJob({ id: 'toggle-me' }));

    expect(store.toggle('bot', 'toggle-me', false)).toBe(true);
    expect(store.list('bot')[0].enabled).toBe(false);
    expect(store.list('bot')[0].updatedAt).toBeGreaterThanOrEqual(created.updatedAt);

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
        peer_id: '123456789',
        account_id: 'default',
        thread_id: 'topic-1',
      },
      createdBy: {
        channel: 'telegram',
        sender_id: '123456789',
        peer_id: '123456789',
        account_id: 'default',
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
        peer_id: '123456789',
        account_id: 'default',
        thread_id: 'topic-1',
      },
      createdBy: {
        channel: 'telegram',
        sender_id: '123456789',
        peer_id: '123456789',
        account_id: 'default',
        thread_id: 'topic-1',
      },
      runOnce: true,
      expiresAt,
      durable: true,
    });
  });

  it('normalizes legacy jobs with delivery metadata into v2 records', () => {
    const path = makePath();
    writeFileSync(path, JSON.stringify([{
      id: 'legacy',
      agentId: 'agent-a',
      schedule: '0 9 * * *',
      prompt: 'legacy prompt',
      deliverTo: { channel: 'telegram', peer_id: 'peer-1' },
      enabled: true,
      createdAt: 100,
    }]));

    const store = new DynamicCronStore(path);
    const [job] = store.list('agent-a');

    expect(job).toMatchObject({
      id: 'legacy',
      durable: true,
      runOnce: false,
      expiresAt: null,
      createdBy: {
        channel: 'telegram',
        peer_id: 'peer-1',
        sender_id: 'peer-1',
      },
      createdAt: 100,
      updatedAt: 100,
    });
  });

  it('drops legacy jobs without a delivery target', () => {
    const path = makePath();
    writeFileSync(path, JSON.stringify([{
      id: 'legacy-background',
      agentId: 'agent-a',
      schedule: '0 9 * * *',
      prompt: 'legacy prompt',
      enabled: true,
      createdAt: 100,
    }]));

    const store = new DynamicCronStore(path);
    expect(store.list('agent-a')).toEqual([]);
  });

  it('getAll returns all jobs', () => {
    const store = new DynamicCronStore(makePath());
    store.create(makeJob({ id: 'a', agentId: 'x', prompt: '1' }));
    store.create(makeJob({ id: 'b', agentId: 'y', prompt: '2' }));

    expect(store.getAll()).toHaveLength(2);
  });

  it('handles missing file gracefully', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'dyncron-test-'));
    const store = new DynamicCronStore(join(tmpDir, 'nonexistent', 'cron.json'));
    expect(store.list('any')).toHaveLength(0);
  });
});
