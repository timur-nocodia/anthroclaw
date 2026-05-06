import { describe, expect, it } from 'vitest';
import { buildPluginStartupPlan } from '../startup-plan.js';
import type { PluginCatalog } from '../discovery.js';

describe('buildPluginStartupPlan', () => {
  it('loads only catalog plugins enabled by at least one agent', () => {
    const plan = buildPluginStartupPlan({
      catalog: catalog(['enabled-plugin', 'disabled-plugin']),
      agentPluginConfigs: [
        { 'enabled-plugin': { enabled: true }, 'disabled-plugin': { enabled: false } },
        { 'missing-plugin': { enabled: true } },
      ],
    });

    expect(plan.loadNames).toEqual(new Set(['enabled-plugin']));
    expect(plan.skippedNames).toEqual(new Set(['disabled-plugin']));
    expect(plan.missingEnabledNames).toEqual(new Set(['missing-plugin']));
  });

  it('does not load enabled catalog entries that are not loadable', () => {
    const plan = buildPluginStartupPlan({
      catalog: {
        entries: [
          entry('broken-plugin', false),
          entry('healthy-plugin', true),
        ],
        duplicates: [],
      },
      agentPluginConfigs: [
        { 'broken-plugin': { enabled: true }, 'healthy-plugin': { enabled: true } },
      ],
    });

    expect(plan.loadNames).toEqual(new Set(['healthy-plugin']));
    expect(plan.unloadableEnabledNames).toEqual(new Set(['broken-plugin']));
  });
});

function catalog(names: string[]): PluginCatalog {
  return { entries: names.map((name) => entry(name, true)), duplicates: [] };
}

function entry(name: string, loadable: boolean): PluginCatalog['entries'][number] {
  return {
    name,
    version: '0.1.0',
    sourceType: 'bundled',
    pluginDir: `/tmp/plugins/${name}`,
    manifestPath: `/tmp/plugins/${name}/.claude-plugin/plugin.json`,
    entryPath: `/tmp/plugins/${name}/dist/index.js`,
    manifest: { name, version: '0.1.0', entry: 'dist/index.js' },
    loadable,
    loaded: false,
    status: loadable ? 'ok' : 'invalid_manifest',
    diagnostics: [],
  };
}
