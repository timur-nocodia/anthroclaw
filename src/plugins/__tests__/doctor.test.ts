import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverPluginCatalog } from '../discovery.js';
import { runPluginDoctor } from '../doctor.js';

describe('runPluginDoctor', () => {
  let root: string;
  let bundledDir: string;
  let managedDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'plugin-doctor-'));
    bundledDir = join(root, 'plugins');
    managedDir = join(root, 'data', 'plugins-installed');
    mkdirSync(bundledDir, { recursive: true });
    mkdirSync(managedDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('reports missing entry files as plugin errors', async () => {
    writePlugin(bundledDir, 'broken-entry', '0.1.0', false);
    const catalog = await discoverPluginCatalog({ bundledDir, managedDir });

    const results = await runPluginDoctor({ catalog, managedDir });

    expect(results).toContainEqual(expect.objectContaining({
      name: 'Plugin: broken-entry',
      status: 'error',
      message: expect.stringContaining('entry missing'),
    }));
  });

  it('reports duplicate plugin names across roots', async () => {
    writePlugin(bundledDir, 'shared-plugin', '0.1.0', true);
    writePlugin(managedDir, 'shared-plugin', '0.2.0', true);
    const catalog = await discoverPluginCatalog({ bundledDir, managedDir });

    const results = await runPluginDoctor({ catalog, managedDir });

    expect(results).toContainEqual(expect.objectContaining({
      name: 'Plugin: shared-plugin',
      status: 'error',
      message: expect.stringContaining('duplicate'),
    }));
  });
});

function writePlugin(root: string, name: string, version: string, withEntry: boolean): void {
  const pluginDir = join(root, name);
  mkdirSync(join(pluginDir, '.claude-plugin'), { recursive: true });
  writeFileSync(
    join(pluginDir, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name, version, entry: 'dist/index.js' }),
    'utf-8',
  );
  if (withEntry) {
    mkdirSync(join(pluginDir, 'dist'), { recursive: true });
    writeFileSync(join(pluginDir, 'dist', 'index.js'), 'export function register() {}\n', 'utf-8');
  }
}
