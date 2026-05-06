import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PluginInstallStore, type PluginInstallRecord } from '../install-store.js';

describe('PluginInstallStore', () => {
  let tmp: string;
  let storePath: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'plugin-install-store-'));
    storePath = join(tmp, 'plugin-installs.json');
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('bootstraps an empty store when no file exists', () => {
    const store = new PluginInstallStore(storePath);
    expect(store.list()).toEqual([]);
  });

  it('writes records atomically as a keyed install map', () => {
    const store = new PluginInstallStore(storePath);
    const record: PluginInstallRecord = {
      name: 'file-transfer',
      sourceType: 'npm',
      sourceSpec: '@anthroclaw/plugin-file-transfer@1.2.3',
      installRoot: join(tmp, 'plugins-installed', 'file-transfer'),
      installedVersion: '1.2.3',
      manifestVersion: '1.2.3',
      installedAt: 1777881600000,
      updatedAt: 1777881600000,
      dependencyState: 'ok',
      status: 'installed',
    };

    store.upsert(record);

    expect(store.get('file-transfer')).toEqual(record);
    const persisted = JSON.parse(readFileSync(storePath, 'utf-8'));
    expect(persisted.installs['file-transfer']).toMatchObject({
      sourceType: 'npm',
      sourceSpec: '@anthroclaw/plugin-file-transfer@1.2.3',
      dependencyState: 'ok',
      status: 'installed',
    });
  });

  it('throws a useful error for corrupted JSON instead of silently resetting installs', () => {
    writeFileSync(storePath, '{not json', 'utf-8');

    expect(() => new PluginInstallStore(storePath)).toThrow(/plugin install store|invalid json/i);
  });

  it('removes records by plugin name', () => {
    const store = new PluginInstallStore(storePath);
    store.upsert({
      name: 'alpha',
      sourceType: 'local',
      sourceSpec: '/tmp/alpha',
      installRoot: '/tmp/alpha',
      installedVersion: '0.1.0',
      manifestVersion: '0.1.0',
      installedAt: 1,
      updatedAt: 1,
      dependencyState: 'unknown',
      status: 'installed',
    });

    expect(store.remove('alpha')).toBe(true);
    expect(store.get('alpha')).toBeNull();
    expect(store.remove('alpha')).toBe(false);
  });
});
