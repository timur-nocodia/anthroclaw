import type { PluginManifest } from './types.js';

export type PluginCatalogSourceType = 'bundled' | 'managed';

export type PluginCatalogStatus =
  | 'ok'
  | 'invalid_manifest'
  | 'missing_manifest'
  | 'duplicate';

export interface PluginCatalogEntry {
  name: string;
  version?: string;
  sourceType: PluginCatalogSourceType;
  sourceSpec?: string;
  pluginDir: string;
  manifestPath: string;
  entryPath?: string;
  manifest?: PluginManifest;
  loadable: boolean;
  loaded: boolean;
  dependencyState?: 'ok' | 'missing' | 'error' | 'unknown';
  status: PluginCatalogStatus;
  diagnostics: string[];
}

export function findDuplicatePluginNames(entries: Pick<PluginCatalogEntry, 'name'>[]): string[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    counts.set(entry.name, (counts.get(entry.name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([name]) => name)
    .sort();
}

export function markDuplicateCatalogEntries(entries: PluginCatalogEntry[]): PluginCatalogEntry[] {
  const duplicates = new Set(findDuplicatePluginNames(entries));
  if (duplicates.size === 0) return entries;

  return entries.map((entry) => {
    if (!duplicates.has(entry.name)) return entry;
    return {
      ...entry,
      loadable: false,
      status: 'duplicate',
      diagnostics: [
        ...entry.diagnostics,
        `duplicate plugin name "${entry.name}" discovered across plugin roots`,
      ],
    };
  });
}
