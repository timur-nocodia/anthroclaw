import { readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { parsePluginManifest } from './manifest-schema.js';
import type { PluginInstallRecord } from './install-store.js';
import {
  markDuplicateCatalogEntries,
  type PluginCatalogEntry,
  type PluginCatalogSourceType,
} from './catalog.js';

export interface DiscoverPluginCatalogInput {
  bundledDir?: string;
  managedDir?: string;
  installRecords?: PluginInstallRecord[];
}

export interface PluginCatalog {
  entries: PluginCatalogEntry[];
  duplicates: string[];
}

interface RootCandidate {
  pluginDir: string;
  sourceType: PluginCatalogSourceType;
  installRecord?: PluginInstallRecord;
}

export async function discoverPluginCatalog(input: DiscoverPluginCatalogInput): Promise<PluginCatalog> {
  const candidates: RootCandidate[] = [];
  if (input.bundledDir) {
    candidates.push(...await discoverRoot(input.bundledDir, 'bundled'));
  }
  if (input.managedDir) {
    candidates.push(...await discoverRoot(input.managedDir, 'managed'));
  }

  const recordsByRoot = new Map((input.installRecords ?? []).map((record) => [record.installRoot, record]));
  const seenDirs = new Set(candidates.map((candidate) => candidate.pluginDir));
  for (const record of input.installRecords ?? []) {
    if (!seenDirs.has(record.installRoot)) {
      candidates.push({ pluginDir: record.installRoot, sourceType: 'managed', installRecord: record });
    }
  }

  const entries = await Promise.all(candidates.map((candidate) => {
    const installRecord = candidate.installRecord ?? recordsByRoot.get(candidate.pluginDir);
    return candidateToEntry(candidate, installRecord);
  }));
  const marked = markDuplicateCatalogEntries(entries);
  const duplicates = [...new Set(marked.filter((entry) => entry.status === 'duplicate').map((entry) => entry.name))].sort();
  return { entries: marked, duplicates };
}

async function discoverRoot(root: string, sourceType: PluginCatalogSourceType): Promise<RootCandidate[]> {
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }

  const candidates: RootCandidate[] = [];
  for (const entry of entries) {
    if (entry.startsWith('.')) continue;
    const pluginDir = join(root, entry);
    try {
      const dirStat = await stat(pluginDir);
      if (!dirStat.isDirectory()) continue;
    } catch {
      continue;
    }
    candidates.push({ pluginDir, sourceType });
  }
  return candidates;
}

async function candidateToEntry(
  candidate: RootCandidate,
  installRecord: PluginInstallRecord | undefined,
): Promise<PluginCatalogEntry> {
  const manifestPath = join(candidate.pluginDir, '.claude-plugin', 'plugin.json');
  const fallbackName = installRecord?.name ?? basename(candidate.pluginDir);
  try {
    const manifest = await parsePluginManifest(manifestPath);
    return {
      name: manifest.name,
      version: manifest.version,
      sourceType: candidate.sourceType,
      ...(installRecord ? { sourceSpec: installRecord.sourceSpec } : {}),
      pluginDir: candidate.pluginDir,
      manifestPath,
      entryPath: join(candidate.pluginDir, manifest.entry),
      manifest,
      loadable: true,
      loaded: false,
      ...(installRecord ? { dependencyState: installRecord.dependencyState } : {}),
      status: 'ok',
      diagnostics: [],
    };
  } catch (err) {
    return {
      name: fallbackName,
      sourceType: candidate.sourceType,
      ...(installRecord ? {
        version: installRecord.manifestVersion,
        sourceSpec: installRecord.sourceSpec,
        dependencyState: installRecord.dependencyState,
      } : {}),
      pluginDir: candidate.pluginDir,
      manifestPath,
      loadable: false,
      loaded: false,
      status: (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing_manifest' : 'invalid_manifest',
      diagnostics: [err instanceof Error ? err.message : String(err)],
    };
  }
}
