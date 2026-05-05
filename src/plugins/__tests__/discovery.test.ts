import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverPluginCatalog } from '../discovery.js';
import type { PluginInstallRecord } from '../install-store.js';

describe('discoverPluginCatalog', () => {
  let tmp: string;
  let bundledDir: string;
  let managedDir: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'plugin-catalog-discovery-'));
    bundledDir = join(tmp, 'bundled');
    managedDir = join(tmp, 'managed');
    mkdirSync(bundledDir, { recursive: true });
    mkdirSync(managedDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('discovers bundled and managed plugin manifests without importing plugin entrypoints', async () => {
    writePlugin(bundledDir, 'lcm', '0.1.0');
    writePlugin(managedDir, 'file-transfer', '1.2.3');

    const catalog = await discoverPluginCatalog({
      bundledDir,
      managedDir,
      installRecords: [
        installRecord('file-transfer', join(managedDir, 'file-transfer'), '1.2.3'),
      ],
    });

    expect(catalog.entries.map((entry) => `${entry.name}:${entry.sourceType}`).sort()).toEqual([
      'file-transfer:managed',
      'lcm:bundled',
    ]);
    expect(catalog.duplicates).toEqual([]);
    expect(catalog.entries.find((entry) => entry.name === 'file-transfer')).toMatchObject({
      sourceSpec: '@anthroclaw/plugin-file-transfer@1.2.3',
      dependencyState: 'ok',
      loaded: false,
    });
  });

  it('marks duplicate plugin names across roots as duplicate and excludes them from loadable entries', async () => {
    writePlugin(bundledDir, 'shared', '0.1.0');
    writePlugin(managedDir, 'shared', '0.2.0');

    const catalog = await discoverPluginCatalog({
      bundledDir,
      managedDir,
      installRecords: [installRecord('shared', join(managedDir, 'shared'), '0.2.0')],
    });

    expect(catalog.duplicates).toEqual(['shared']);
    expect(catalog.entries.filter((entry) => entry.name === 'shared')).toHaveLength(2);
    expect(catalog.entries.every((entry) => entry.loadable === false)).toBe(true);
    expect(catalog.entries.every((entry) => entry.status === 'duplicate')).toBe(true);
  });

  it('returns invalid manifest diagnostics without throwing', async () => {
    mkdirSync(join(managedDir, 'broken', '.claude-plugin'), { recursive: true });
    writeFileSync(join(managedDir, 'broken', '.claude-plugin', 'plugin.json'), '{ "broken": true }', 'utf-8');

    const catalog = await discoverPluginCatalog({
      bundledDir,
      managedDir,
      installRecords: [installRecord('broken', join(managedDir, 'broken'), '0.1.0')],
    });

    expect(catalog.entries).toHaveLength(1);
    expect(catalog.entries[0]).toMatchObject({
      name: 'broken',
      sourceType: 'managed',
      loadable: false,
      status: 'invalid_manifest',
    });
    expect(catalog.entries[0].diagnostics.join('\n')).toMatch(/invalid plugin manifest/i);
  });
});

function writePlugin(root: string, name: string, version: string): void {
  const pluginDir = join(root, name);
  mkdirSync(join(pluginDir, '.claude-plugin'), { recursive: true });
  writeFileSync(
    join(pluginDir, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name, version, entry: 'dist/index.js' }),
    'utf-8',
  );
}

function installRecord(name: string, installRoot: string, version: string): PluginInstallRecord {
  return {
    name,
    sourceType: 'npm',
    sourceSpec: `@anthroclaw/plugin-${name}@${version}`,
    installRoot,
    installedVersion: version,
    manifestVersion: version,
    installedAt: 1,
    updatedAt: 1,
    dependencyState: 'ok',
    status: 'installed',
  };
}
