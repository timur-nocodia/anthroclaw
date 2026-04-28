import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverPlugins, loadPlugin } from '../loader.js';

describe('discoverPlugins', () => {
  let tmp: string;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'plugins-test-')); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it('returns empty array when plugins dir is empty', async () => {
    const result = await discoverPlugins(tmp);
    expect(result).toEqual([]);
  });

  it('returns empty array when plugins dir does not exist', async () => {
    const result = await discoverPlugins(join(tmp, 'nonexistent'));
    expect(result).toEqual([]);
  });

  it('discovers single valid plugin', async () => {
    const pluginDir = join(tmp, 'foo');
    mkdirSync(join(pluginDir, '.claude-plugin'), { recursive: true });
    writeFileSync(
      join(pluginDir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'foo', version: '0.1.0', entry: 'dist/index.js' })
    );
    const result = await discoverPlugins(tmp);
    expect(result).toHaveLength(1);
    expect(result[0].manifest.name).toBe('foo');
    expect(result[0].pluginDir).toBe(pluginDir);
  });

  it('skips plugins with invalid manifest (logs but does not throw)', async () => {
    mkdirSync(join(tmp, 'broken/.claude-plugin'), { recursive: true });
    writeFileSync(join(tmp, 'broken/.claude-plugin/plugin.json'), '{ "broken": true }');
    mkdirSync(join(tmp, 'good/.claude-plugin'), { recursive: true });
    writeFileSync(
      join(tmp, 'good/.claude-plugin/plugin.json'),
      JSON.stringify({ name: 'good', version: '0.1.0', entry: 'dist/index.js' })
    );
    const result = await discoverPlugins(tmp);
    expect(result).toHaveLength(1);
    expect(result[0].manifest.name).toBe('good');
  });

  it('skips dirs without .claude-plugin/plugin.json', async () => {
    mkdirSync(join(tmp, 'random-dir'), { recursive: true });
    writeFileSync(join(tmp, 'random-dir', 'README.md'), '# not a plugin');
    const result = await discoverPlugins(tmp);
    expect(result).toEqual([]);
  });

  it('discovers multiple plugins', async () => {
    for (const name of ['alpha', 'bravo', 'charlie']) {
      mkdirSync(join(tmp, name, '.claude-plugin'), { recursive: true });
      writeFileSync(
        join(tmp, name, '.claude-plugin', 'plugin.json'),
        JSON.stringify({ name, version: '0.1.0', entry: 'dist/index.js' })
      );
    }
    const result = await discoverPlugins(tmp);
    expect(result).toHaveLength(3);
    expect(result.map(r => r.manifest.name).sort()).toEqual(['alpha', 'bravo', 'charlie']);
  });
});

describe('loadPlugin', () => {
  let tmp: string;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'plugin-load-test-')); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it('loads valid plugin and returns module with register function', async () => {
    const pluginDir = join(tmp, 'test-plugin');
    mkdirSync(join(pluginDir, '.claude-plugin'), { recursive: true });
    mkdirSync(join(pluginDir, 'dist'), { recursive: true });
    writeFileSync(
      join(pluginDir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'test', version: '0.1.0', entry: 'dist/index.js' })
    );
    writeFileSync(
      join(pluginDir, 'dist', 'index.js'),
      'export async function register(ctx) { return { shutdown: () => {} }; }'
    );
    writeFileSync(join(pluginDir, 'dist', 'package.json'), '{ "type": "module" }');

    const discovered = await discoverPlugins(tmp);
    expect(discovered).toHaveLength(1);

    const mod = await loadPlugin(discovered[0]);
    expect(typeof mod.register).toBe('function');
  });

  it('throws if entry file does not exist', async () => {
    const pluginDir = join(tmp, 'no-entry');
    mkdirSync(join(pluginDir, '.claude-plugin'), { recursive: true });
    writeFileSync(
      join(pluginDir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'noentry', version: '0.1.0', entry: 'dist/missing.js' })
    );

    const discovered = await discoverPlugins(tmp);
    await expect(loadPlugin(discovered[0])).rejects.toThrow(/entry|missing|cannot find/i);
  });

  it('throws if entry does not export register', async () => {
    const pluginDir = join(tmp, 'no-register');
    mkdirSync(join(pluginDir, '.claude-plugin'), { recursive: true });
    mkdirSync(join(pluginDir, 'dist'), { recursive: true });
    writeFileSync(
      join(pluginDir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'noreg', version: '0.1.0', entry: 'dist/index.js' })
    );
    writeFileSync(join(pluginDir, 'dist', 'index.js'), 'export const foo = 1;');
    writeFileSync(join(pluginDir, 'dist', 'package.json'), '{ "type": "module" }');

    const discovered = await discoverPlugins(tmp);
    await expect(loadPlugin(discovered[0])).rejects.toThrow(/register/i);
  });

  it('respects requires.anthroclaw semver constraint', async () => {
    const pluginDir = join(tmp, 'incompat');
    mkdirSync(join(pluginDir, '.claude-plugin'), { recursive: true });
    mkdirSync(join(pluginDir, 'dist'), { recursive: true });
    writeFileSync(
      join(pluginDir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({
        name: 'incompat', version: '0.1.0', entry: 'dist/index.js',
        requires: { anthroclaw: '>=99.0.0' },
      })
    );
    writeFileSync(
      join(pluginDir, 'dist', 'index.js'),
      'export async function register() { return {}; }'
    );
    writeFileSync(join(pluginDir, 'dist', 'package.json'), '{ "type": "module" }');

    const discovered = await discoverPlugins(tmp);
    await expect(
      loadPlugin(discovered[0], { anthroclawVersion: '0.5.0' })
    ).rejects.toThrow(/version|requires|incompatible/i);
  });
});
