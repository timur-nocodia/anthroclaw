import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startPluginsWatcher } from '../watcher.js';

describe('startPluginsWatcher', () => {
  let tmp: string;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'plugins-watch-')); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it('detects new plugin and calls onAdd', async () => {
    const onAdd = vi.fn();
    const onRemove = vi.fn();
    const watcher = startPluginsWatcher(tmp, { onAdd, onRemove });

    await new Promise(r => setTimeout(r, 100));    // wait for ready

    mkdirSync(join(tmp, 'foo/.claude-plugin'), { recursive: true });
    writeFileSync(
      join(tmp, 'foo/.claude-plugin/plugin.json'),
      JSON.stringify({ name: 'foo', version: '0.1.0', entry: 'dist/index.js' })
    );

    await new Promise(r => setTimeout(r, 700));    // wait for chokidar event
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({
      manifest: expect.objectContaining({ name: 'foo' }),
    }));

    await watcher.close();
  });

  it('detects plugin manifest deletion and calls onRemove', async () => {
    mkdirSync(join(tmp, 'bar/.claude-plugin'), { recursive: true });
    writeFileSync(
      join(tmp, 'bar/.claude-plugin/plugin.json'),
      JSON.stringify({ name: 'bar', version: '0.1.0', entry: 'dist/index.js' })
    );

    const onRemove = vi.fn();
    const watcher = startPluginsWatcher(tmp, { onAdd: vi.fn(), onRemove });
    await new Promise(r => setTimeout(r, 300));

    rmSync(join(tmp, 'bar'), { recursive: true });
    await new Promise(r => setTimeout(r, 700));

    expect(onRemove).toHaveBeenCalledWith('bar');
    await watcher.close();
  });

  it('does not fire onAdd for plugins existing at watcher start (ignoreInitial)', async () => {
    // Setup: plugin already exists BEFORE watcher starts.
    // We write the file and then pause long enough for FSEvents (macOS) to deliver
    // the creation events to the OS, so they are NOT mistaken for post-start changes.
    mkdirSync(join(tmp, 'pre-existing/.claude-plugin'), { recursive: true });
    writeFileSync(
      join(tmp, 'pre-existing/.claude-plugin/plugin.json'),
      JSON.stringify({ name: 'pre-existing', version: '0.1.0', entry: 'dist/index.js' })
    );
    await new Promise(r => setTimeout(r, 500));  // let FSEvents settle before watcher starts

    const onAdd = vi.fn();
    const watcher = startPluginsWatcher(tmp, { onAdd, onRemove: vi.fn() });
    await new Promise(r => setTimeout(r, 800));   // plenty of time for any wrong fire

    expect(onAdd).not.toHaveBeenCalled();
    await watcher.close();
  });

  it('detects manifest change and calls onRemove + onAdd', async () => {
    mkdirSync(join(tmp, 'baz/.claude-plugin'), { recursive: true });
    writeFileSync(
      join(tmp, 'baz/.claude-plugin/plugin.json'),
      JSON.stringify({ name: 'baz', version: '0.1.0', entry: 'dist/index.js' })
    );

    const onAdd = vi.fn();
    const onRemove = vi.fn();
    const watcher = startPluginsWatcher(tmp, { onAdd, onRemove });
    await new Promise(r => setTimeout(r, 300));
    onAdd.mockClear();   // ignore initial-add

    // Modify the manifest
    writeFileSync(
      join(tmp, 'baz/.claude-plugin/plugin.json'),
      JSON.stringify({ name: 'baz', version: '0.2.0', entry: 'dist/index.js' })
    );

    await new Promise(r => setTimeout(r, 700));
    expect(onRemove).toHaveBeenCalledWith('baz');
    expect(onAdd).toHaveBeenCalled();

    await watcher.close();
  });
});
