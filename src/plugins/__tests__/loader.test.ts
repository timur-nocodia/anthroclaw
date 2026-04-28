import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverPlugins } from '../loader.js';

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
