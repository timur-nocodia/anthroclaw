import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync, unlinkSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ConfigWatcher } from '../../src/config/watcher.js';

describe('ConfigWatcher', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'watcher-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('calls onReload when agent.yml is modified', async () => {
    // Create initial agent directory with agent.yml
    const agentDir = join(tmpDir, 'test-agent');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, 'agent.yml'), 'routes:\n  - channel: telegram\n    scope: dm\n');

    const onReload = vi.fn();
    const watcher = new ConfigWatcher(onReload, { debounceMs: 100 });
    watcher.start(tmpDir);

    // Give fs.watch time to initialize
    await sleep(100);

    // Modify agent.yml
    writeFileSync(join(agentDir, 'agent.yml'), 'routes:\n  - channel: whatsapp\n    scope: dm\n');

    // Wait for debounce + fs.watch delay
    await sleep(400);

    expect(onReload).toHaveBeenCalled();

    watcher.stop();
  });

  it('debounces multiple rapid changes into one callback', async () => {
    const agentDir = join(tmpDir, 'test-agent');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, 'agent.yml'), 'routes:\n  - channel: telegram\n    scope: dm\n');

    const onReload = vi.fn();
    const watcher = new ConfigWatcher(onReload, { debounceMs: 200 });
    watcher.start(tmpDir);

    await sleep(100);

    // Rapid-fire changes
    writeFileSync(join(agentDir, 'agent.yml'), 'routes:\n  - channel: telegram\n    scope: any\n');
    await sleep(50);
    writeFileSync(join(agentDir, 'agent.yml'), 'routes:\n  - channel: whatsapp\n    scope: dm\n');
    await sleep(50);
    writeFileSync(join(agentDir, 'agent.yml'), 'routes:\n  - channel: whatsapp\n    scope: any\n');

    // Wait for debounce to fire
    await sleep(500);

    // Should have been called exactly once due to debouncing
    expect(onReload).toHaveBeenCalledTimes(1);

    watcher.stop();
  });

  it('calls onReload when a new agent directory is added', async () => {
    // Start with an empty agents dir
    const onReload = vi.fn();
    const watcher = new ConfigWatcher(onReload, { debounceMs: 100 });
    watcher.start(tmpDir);

    await sleep(100);

    // Add a new agent directory
    const agentDir = join(tmpDir, 'new-agent');
    mkdirSync(agentDir);

    await sleep(400);

    expect(onReload).toHaveBeenCalled();

    watcher.stop();
  });

  it('stop() prevents further callbacks', async () => {
    const agentDir = join(tmpDir, 'test-agent');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, 'agent.yml'), 'routes:\n  - channel: telegram\n    scope: dm\n');

    const onReload = vi.fn();
    const watcher = new ConfigWatcher(onReload, { debounceMs: 100 });
    watcher.start(tmpDir);

    await sleep(100);

    // Stop the watcher
    watcher.stop();

    // Modify agent.yml after stop
    writeFileSync(join(agentDir, 'agent.yml'), 'routes:\n  - channel: whatsapp\n    scope: dm\n');

    await sleep(400);

    expect(onReload).not.toHaveBeenCalled();
  });

  it('start() is idempotent — calling twice does not create duplicate watchers', async () => {
    const agentDir = join(tmpDir, 'test-agent');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, 'agent.yml'), 'routes:\n  - channel: telegram\n    scope: dm\n');

    const onReload = vi.fn();
    const watcher = new ConfigWatcher(onReload, { debounceMs: 100 });
    watcher.start(tmpDir);
    watcher.start(tmpDir); // second call should be ignored (no-op)

    await sleep(100);

    writeFileSync(join(agentDir, 'agent.yml'), 'routes:\n  - channel: whatsapp\n    scope: dm\n');

    await sleep(400);

    // Debouncing collapses all fs events into callback(s); with a single
    // watcher the count should be >= 1 but never more than a small number.
    // The key invariant: calling start() twice does not double the callbacks.
    expect(onReload.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(onReload.mock.calls.length).toBeLessThanOrEqual(2);

    watcher.stop();
  });

  it('handles nonexistent directory gracefully', () => {
    const onReload = vi.fn();
    const watcher = new ConfigWatcher(onReload, { debounceMs: 100 });

    // Should not throw
    watcher.start(join(tmpDir, 'does-not-exist'));

    watcher.stop();
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
