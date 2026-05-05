import { describe, expect, it } from 'vitest';
import { findDuplicatePluginNames, markDuplicateCatalogEntries, type PluginCatalogEntry } from '../catalog.js';

describe('plugin catalog helpers', () => {
  it('finds duplicate plugin names across catalog entries', () => {
    expect(findDuplicatePluginNames([
      entry('alpha', 'bundled'),
      entry('bravo', 'bundled'),
      entry('alpha', 'managed'),
    ])).toEqual(['alpha']);
  });

  it('marks duplicate entries as not loadable while preserving non-duplicates', () => {
    const entries = markDuplicateCatalogEntries([
      entry('alpha', 'bundled'),
      entry('alpha', 'managed'),
      entry('bravo', 'bundled'),
    ]);

    expect(entries.find((candidate) => candidate.name === 'bravo')).toMatchObject({
      loadable: true,
      status: 'ok',
    });
    expect(entries.filter((candidate) => candidate.name === 'alpha')).toEqual([
      expect.objectContaining({ loadable: false, status: 'duplicate' }),
      expect.objectContaining({ loadable: false, status: 'duplicate' }),
    ]);
  });
});

function entry(name: string, sourceType: 'bundled' | 'managed'): PluginCatalogEntry {
  return {
    name,
    version: '0.1.0',
    sourceType,
    pluginDir: `/plugins/${name}`,
    manifestPath: `/plugins/${name}/.claude-plugin/plugin.json`,
    entryPath: `/plugins/${name}/dist/index.js`,
    manifest: { name, version: '0.1.0', entry: 'dist/index.js' },
    loadable: true,
    loaded: false,
    status: 'ok',
    diagnostics: [],
  };
}
