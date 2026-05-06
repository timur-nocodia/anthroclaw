import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { PluginCatalog } from './discovery.js';

export interface PluginDoctorResult {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  fix?: string;
}

export async function runPluginDoctor(opts: {
  catalog: PluginCatalog;
  managedDir?: string;
}): Promise<PluginDoctorResult[]> {
  const results: PluginDoctorResult[] = [];

  if (opts.managedDir) {
    results.push(checkManagedInstallRoot(opts.managedDir));
  }

  for (const entry of opts.catalog.entries) {
    if (entry.status === 'duplicate') {
      results.push({
        name: `Plugin: ${entry.name}`,
        status: 'error',
        message: `duplicate plugin name across roots: ${entry.name}`,
        fix: 'Remove or rename one duplicate plugin install.',
      });
      continue;
    }

    if (entry.status === 'missing_manifest') {
      results.push({
        name: `Plugin: ${entry.name}`,
        status: 'error',
        message: `manifest missing: ${entry.manifestPath}`,
        fix: 'Install a valid .claude-plugin/plugin.json or remove the broken plugin directory.',
      });
      continue;
    }

    if (entry.status === 'invalid_manifest') {
      results.push({
        name: `Plugin: ${entry.name}`,
        status: 'error',
        message: `manifest invalid: ${entry.diagnostics.join('; ')}`,
        fix: 'Fix the plugin manifest schema errors.',
      });
      continue;
    }

    if (entry.entryPath && !existsSync(entry.entryPath)) {
      results.push({
        name: `Plugin: ${entry.name}`,
        status: 'error',
        message: `entry missing: ${entry.entryPath}`,
        fix: 'Build or reinstall the plugin so its compiled entry exists.',
      });
      continue;
    }

    if (entry.dependencyState === 'missing' || entry.dependencyState === 'error') {
      results.push({
        name: `Plugin: ${entry.name}`,
        status: 'error',
        message: `dependency install ${entry.dependencyState}`,
        fix: `Reinstall managed plugin ${entry.name}.`,
      });
      continue;
    }

    results.push({
      name: `Plugin: ${entry.name}`,
      status: 'ok',
      message: `${entry.sourceType} ${entry.version ?? 'unknown'} ready`,
    });
  }

  return dedupePluginResults(results);
}

function checkManagedInstallRoot(managedDir: string): PluginDoctorResult {
  if (existsSync(managedDir)) {
    return { name: 'Plugin managed install root', status: 'ok', message: managedDir };
  }
  return {
    name: 'Plugin managed install root',
    status: 'warn',
    message: `${managedDir} does not exist`,
    fix: `Create ${join(managedDir)} or install a managed plugin.`,
  };
}

function dedupePluginResults(results: PluginDoctorResult[]): PluginDoctorResult[] {
  const seen = new Set<string>();
  const out: PluginDoctorResult[] = [];
  for (const result of results) {
    const key = `${result.name}:${result.status}:${result.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(result);
  }
  return out;
}
