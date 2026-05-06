import type { PluginCatalog } from './discovery.js';

export interface BuildPluginStartupPlanInput {
  catalog: PluginCatalog;
  agentPluginConfigs: Array<Record<string, { enabled?: boolean } | undefined>>;
}

export interface PluginStartupPlan {
  loadNames: Set<string>;
  skippedNames: Set<string>;
  missingEnabledNames: Set<string>;
  unloadableEnabledNames: Set<string>;
}

export function buildPluginStartupPlan(input: BuildPluginStartupPlanInput): PluginStartupPlan {
  const enabledNames = new Set<string>();
  for (const plugins of input.agentPluginConfigs) {
    for (const [name, config] of Object.entries(plugins)) {
      if (config?.enabled === true) {
        enabledNames.add(name);
      }
    }
  }

  const catalogByName = new Map(input.catalog.entries.map((entry) => [entry.name, entry]));
  const loadNames = new Set<string>();
  const skippedNames = new Set<string>();
  const missingEnabledNames = new Set<string>();
  const unloadableEnabledNames = new Set<string>();

  for (const name of enabledNames) {
    const entry = catalogByName.get(name);
    if (!entry) {
      missingEnabledNames.add(name);
      continue;
    }
    if (!entry.loadable || !entry.manifest) {
      unloadableEnabledNames.add(name);
      continue;
    }
    loadNames.add(name);
  }

  for (const entry of input.catalog.entries) {
    if (!loadNames.has(entry.name)) {
      skippedNames.add(entry.name);
    }
  }

  return { loadNames, skippedNames, missingEnabledNames, unloadableEnabledNames };
}
