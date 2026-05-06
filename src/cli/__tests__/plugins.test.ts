import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPluginsCli } from '../plugins.js';

describe('plugins CLI', () => {
  let root: string;
  let dataDir: string;
  let pluginsDir: string;
  let localSource: string;
  const out: string[] = [];
  const err: string[] = [];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'plugins-cli-'));
    dataDir = join(root, 'data');
    pluginsDir = join(root, 'plugins');
    localSource = join(root, 'sources', 'file-transfer');
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(pluginsDir, { recursive: true });
    out.length = 0;
    err.length = 0;
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('lists bundled and managed plugins from the catalog', async () => {
    writePlugin(pluginsDir, 'lcm', '0.1.0', true);
    writePlugin(join(dataDir, 'plugins-installed'), 'file-transfer', '1.2.3', true);
    writeFileSync(join(dataDir, 'plugin-installs.json'), JSON.stringify({
      installs: {
        'file-transfer': {
          name: 'file-transfer',
          sourceType: 'local',
          sourceSpec: localSource,
          installRoot: join(dataDir, 'plugins-installed', 'file-transfer'),
          installedVersion: '1.2.3',
          manifestVersion: '1.2.3',
          installedAt: 1,
          updatedAt: 1,
          dependencyState: 'ok',
          status: 'installed',
        },
      },
    }), 'utf-8');

    await expect(run(['list'])).resolves.toBe(0);

    expect(out.join('\n')).toContain('lcm');
    expect(out.join('\n')).toContain('bundled');
    expect(out.join('\n')).toContain('file-transfer');
    expect(out.join('\n')).toContain('managed');
  });

  it('installs a local plugin into data/plugins-installed and records install state', async () => {
    writePlugin(localSource, 'file-transfer', '1.2.3', true);

    await expect(run(['install', localSource])).resolves.toBe(0);

    const installRoot = join(dataDir, 'plugins-installed', 'file-transfer');
    expect(existsSync(join(installRoot, '.claude-plugin', 'plugin.json'))).toBe(true);
    expect(JSON.parse(readFileSync(join(dataDir, 'plugin-installs.json'), 'utf-8')).installs['file-transfer']).toMatchObject({
      sourceType: 'local',
      sourceSpec: localSource,
      installRoot,
      manifestVersion: '1.2.3',
      dependencyState: 'ok',
    });
  });

  it('refuses to install a local plugin with a missing compiled entry', async () => {
    writePlugin(localSource, 'file-transfer', '0.1.0', false);

    await expect(run(['install', localSource])).resolves.toBe(1);

    expect(err.join('\n')).toContain('entry missing');
    expect(existsSync(join(dataDir, 'plugin-installs.json'))).toBe(false);
  });

  it('removes managed plugins only', async () => {
    writePlugin(localSource, 'file-transfer', '1.2.3', true);
    await expect(run(['install', localSource])).resolves.toBe(0);

    await expect(run(['remove', 'file-transfer'])).resolves.toBe(0);

    expect(existsSync(join(dataDir, 'plugins-installed', 'file-transfer'))).toBe(false);
    expect(JSON.parse(readFileSync(join(dataDir, 'plugin-installs.json'), 'utf-8')).installs['file-transfer']).toBeUndefined();
  });

  it('prints doctor failures and returns non-zero when plugin checks fail', async () => {
    writePlugin(pluginsDir, 'broken-entry', '0.1.0', false);

    await expect(run(['doctor'])).resolves.toBe(1);

    expect(out.join('\n')).toContain('Plugin: broken-entry');
    expect(out.join('\n')).toContain('entry missing');
  });

  function run(argv: string[]): Promise<number> {
    return runPluginsCli([
      ...argv,
      '--data-dir',
      dataDir,
      '--plugins-dir',
      pluginsDir,
    ], {
      stdout: (text) => out.push(text),
      stderr: (text) => err.push(text),
    });
  }
});

function writePlugin(root: string, name: string, version: string, withEntry: boolean): void {
  const pluginDir = root.endsWith(name) ? root : join(root, name);
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
