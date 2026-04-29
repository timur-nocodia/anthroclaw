import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { satisfies as semverSatisfies } from 'semver';
import { logger } from '../logger.js';
import { parsePluginManifest } from './manifest-schema.js';
import type { PluginManifest, PluginEntryModule } from './types.js';

export interface DiscoveredPlugin {
  manifest: PluginManifest;
  pluginDir: string;            // абсолютный путь к директории плагина
  manifestPath: string;
}

/**
 * Сканит pluginsDir на subdir-ы вида {pluginsDir}/{name}/.claude-plugin/plugin.json
 * Возвращает только плагины с валидным manifest.
 * Не throw — invalid manifest логируется и пропускается.
 */
export async function discoverPlugins(pluginsDir: string): Promise<DiscoveredPlugin[]> {
  let entries: string[];
  try {
    entries = await readdir(pluginsDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }

  const discovered: DiscoveredPlugin[] = [];
  for (const entry of entries) {
    if (entry.startsWith('.')) continue;        // скип скрытых

    const pluginDir = join(pluginsDir, entry);
    const manifestPath = join(pluginDir, '.claude-plugin', 'plugin.json');

    try {
      const dirStat = await stat(pluginDir);
      if (!dirStat.isDirectory()) continue;
      await stat(manifestPath);
    } catch {
      continue;     // нет manifest или не директория — пропускаем
    }

    try {
      const manifest = await parsePluginManifest(manifestPath);
      discovered.push({ manifest, pluginDir, manifestPath });
    } catch (err) {
      logger.warn(
        { err: (err as Error).message, manifestPath },
        'plugin: skipping invalid manifest'
      );
    }
  }

  return discovered;
}

export interface LoadPluginOpts {
  anthroclawVersion?: string;
}

export async function loadPlugin(
  discovered: DiscoveredPlugin,
  opts: LoadPluginOpts = {},
): Promise<PluginEntryModule> {
  // 1. Semver compat check
  const requiresAnthroclaw = discovered.manifest.requires?.anthroclaw;
  if (requiresAnthroclaw && opts.anthroclawVersion) {
    if (!semverSatisfies(opts.anthroclawVersion, requiresAnthroclaw)) {
      throw new Error(
        `plugin ${discovered.manifest.name}@${discovered.manifest.version} requires ` +
        `anthroclaw ${requiresAnthroclaw}, but current version is ${opts.anthroclawVersion}`
      );
    }
  }

  // 2. Resolve entry path
  const entryAbs = join(discovered.pluginDir, discovered.manifest.entry);

  // 3. Dynamic import via file:// URL for ESM compatibility.
  // The /* webpackIgnore: true */ comment tells Next.js's webpack bundler to
  // leave this dynamic import as a runtime call instead of attempting to
  // bundle the resolved module — plugins live outside the Next.js build
  // tree and are loaded from /app/plugins/<name>/dist/ at runtime, so
  // webpack must not pre-resolve them. Without this comment, prod builds
  // throw "Cannot find module" even when the file exists on disk.
  let mod: unknown;
  try {
    mod = await import(/* webpackIgnore: true */ pathToFileURL(entryAbs).href);
  } catch (err) {
    throw new Error(
      `failed to import plugin entry ${entryAbs}: ${(err as Error).message}`
    );
  }

  // 4. Validate register() export
  const m = mod as Record<string, unknown>;
  if (typeof m.register !== 'function') {
    throw new Error(
      `plugin ${discovered.manifest.name} entry ${discovered.manifest.entry} ` +
      `does not export a register() function`
    );
  }

  return m as unknown as PluginEntryModule;
}
