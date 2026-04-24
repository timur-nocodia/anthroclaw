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

  function makeTool() {
    tmpDir = mkdtempSync(join(tmpdir(), 'cron-tool-test-'));
    const store = new DynamicCronStore(join(tmpDir, 'cron.json'));
    const onUpdate = vi.fn();
    return { tool: createManageCronTool('test-agent', store, onUpdate), store, onUpdate };
  }

  it('has correct name', () => {
    const { tool } = makeTool();
    expect(tool.name).toBe('manage_cron');
  });

  it('creates a job', async () => {
    const { tool, onUpdate } = makeTool();
    const res = await tool.handler({
      action: 'create',
      id: 'daily-hello',
      schedule: '0 9 * * *',
      prompt: 'Say hello',
    });
    expect(res.content[0].text).toContain('daily-hello');
    expect(res.content[0].text).toContain('created');
    expect(onUpdate).toHaveBeenCalled();
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
