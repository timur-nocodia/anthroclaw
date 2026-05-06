import { cpSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parsePluginManifest } from '../manifest-schema.js';
import { PluginInstallStore, type PluginInstallRecord, type PluginInstallSourceType } from '../install-store.js';

export interface InstallLocalPluginInput {
  sourcePath: string;
  dataDir: string;
  sourceType?: Extract<PluginInstallSourceType, 'local' | 'npm'>;
  sourceSpec?: string;
  now?: number;
}

export async function installLocalPlugin(input: InstallLocalPluginInput): Promise<PluginInstallRecord> {
  const sourceRoot = resolve(input.sourcePath);
  const sourceSpec = input.sourceSpec ?? sourceRoot;
  const sourceType = input.sourceType ?? 'local';
  const manifest = await validatePluginSource(sourceRoot);
  const managedRoot = join(resolve(input.dataDir), 'plugins-installed');
  const installRoot = join(managedRoot, manifest.name);
  const store = new PluginInstallStore(join(resolve(input.dataDir), 'plugin-installs.json'));
  const existing = store.get(manifest.name);
  const now = input.now ?? Date.now();
  const tmpRoot = `${installRoot}.tmp-${process.pid}-${now}`;

  mkdirSync(managedRoot, { recursive: true });
  rmSync(tmpRoot, { recursive: true, force: true });
  cpSync(sourceRoot, tmpRoot, { recursive: true, dereference: false });
  await validatePluginSource(tmpRoot);
  rmSync(installRoot, { recursive: true, force: true });
  renameSync(tmpRoot, installRoot);

  const record: PluginInstallRecord = {
    name: manifest.name,
    sourceType,
    sourceSpec,
    installRoot,
    installedVersion: manifest.version,
    manifestVersion: manifest.version,
    installedAt: existing?.installedAt ?? now,
    updatedAt: now,
    dependencyState: 'ok',
    status: 'installed',
  };
  store.upsert(record);
  return record;
}

export async function validatePluginSource(pluginDir: string): Promise<{
  name: string;
  version: string;
  entry: string;
}> {
  const manifest = await parsePluginManifest(join(pluginDir, '.claude-plugin', 'plugin.json'));
  const entryPath = join(pluginDir, manifest.entry);
  if (!existsSync(entryPath)) {
    throw new Error(`entry missing: ${entryPath}`);
  }
  return manifest;
}
