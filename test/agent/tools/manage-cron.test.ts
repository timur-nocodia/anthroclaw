import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DynamicCronStore } from '../../../src/cron/dynamic-store.js';
import { createManageCronTool } from '../../../src/agent/tools/manage-cron.js';

describe('createManageCronTool', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeTool(withContext = true) {
    tmpDir = mkdtempSync(join(tmpdir(), 'cron-tool-test-'));
    const store = new DynamicCronStore(join(tmpDir, 'cron.json'));
    const onUpdate = vi.fn();
    const dispatchContext = withContext
      ? {
          agentId: 'test-agent',
          channel: 'telegram',
          peerId: '48705953',
          senderId: '48705953',
          accountId: 'content_sm',
          threadId: 'topic-1',
        }
      : undefined;
    return { tool: createManageCronTool('test-agent', store, onUpdate, dispatchContext), store, onUpdate };
  }

  it('has correct name', () => {
    const { tool } = makeTool();
    expect(tool.name).toBe('manage_cron');
  });

  it('creates a job', async () => {
    const { tool, store, onUpdate } = makeTool();
    const res = await tool.handler({
      action: 'create',
      id: 'daily-hello',
      schedule: '0 9 * * *',
      prompt: 'Say hello',
    });
    expect(res.content[0].text).toContain('daily-hello');
    expect(res.content[0].text).toContain('created');
    expect(store.list('test-agent')[0]).toMatchObject({
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
      runOnce: false,
    });
    expect(onUpdate).toHaveBeenCalled();
  });

  it('creates an ID when create omits one', async () => {
    const { tool, store } = makeTool();
    const res = await tool.handler({
      action: 'create',
      schedule: '0 9 * * *',
      prompt: 'Say hello',
    });
    expect(res.isError).toBeUndefined();
    expect(store.list('test-agent')[0].id).toMatch(/^say-hello-/);
  });

  it('ignores model-supplied deliver_to and binds current dispatch context', async () => {
    const { tool, store } = makeTool();
    await tool.handler({
      action: 'create',
      id: 'bad-target',
      schedule: '0 9 * * *',
      prompt: 'hello',
      deliver_to: { channel: 'telegram', peer_id: 'timur@nocodia.dev' },
    });
    expect(store.list('test-agent')[0].deliverTo).toEqual({
      channel: 'telegram',
      peer_id: '48705953',
      account_id: 'content_sm',
      thread_id: 'topic-1',
    });
  });

  it('marks concrete day/month schedules as run once and stores expiration', async () => {
    const { tool, store } = makeTool();
    await tool.handler({
      action: 'create',
      id: 'plannerka',
      schedule: '0 8 30 4 *',
      prompt: 'remind me',
      expires_at: '2026-05-01T00:00:00.000Z',
    });
    expect(store.list('test-agent')[0]).toMatchObject({
      runOnce: true,
      expiresAt: Date.parse('2026-05-01T00:00:00.000Z'),
    });
  });

  it('requires dispatch context for create', async () => {
    const { tool } = makeTool(false);
    const res = await tool.handler({
      action: 'create',
      id: 'no-context',
      schedule: '0 9 * * *',
      prompt: 'hello',
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('active chat dispatch context');
  });

  it('lists jobs', async () => {
    const { tool } = makeTool();
    await tool.handler({ action: 'create', id: 'j1', schedule: '* * * * *', prompt: 'test' });
    const res = await tool.handler({ action: 'list' });
    expect(res.content[0].text).toContain('j1');
    expect(res.content[0].text).toContain('Dynamic cron jobs (1)');
  });

  it('returns empty message when no jobs', async () => {
    const { tool } = makeTool();
    const res = await tool.handler({ action: 'list' });
    expect(res.content[0].text).toContain('No dynamic cron jobs');
  });

  it('deletes a job', async () => {
    const { tool, onUpdate } = makeTool();
    await tool.handler({ action: 'create', id: 'to-del', schedule: '* * * * *', prompt: 'test' });
    onUpdate.mockClear();

    const res = await tool.handler({ action: 'delete', id: 'to-del' });
    expect(res.content[0].text).toContain('deleted');
    expect(onUpdate).toHaveBeenCalled();
  });

  it('toggles a job', async () => {
    const { tool, onUpdate } = makeTool();
    await tool.handler({ action: 'create', id: 'toggler', schedule: '* * * * *', prompt: 'test' });
    onUpdate.mockClear();

    const res = await tool.handler({ action: 'toggle', id: 'toggler', enabled: false });
    expect(res.content[0].text).toContain('disabled');
    expect(onUpdate).toHaveBeenCalled();
  });

  it('returns error for create with missing params', async () => {
    const { tool } = makeTool();
    const res = await tool.handler({ action: 'create' });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('required');
  });

  it('returns error for deleting nonexistent job', async () => {
    const { tool } = makeTool();
    const res = await tool.handler({ action: 'delete', id: 'nope' });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('not found');
  });

  it('returns error for unknown action', async () => {
    const { tool } = makeTool();
    const res = await tool.handler({ action: 'fly' });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('Unknown action');
  });
});
