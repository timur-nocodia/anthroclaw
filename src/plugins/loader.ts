import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from '../logger.js';
import { parsePluginManifest } from './manifest-schema.js';
import type { PluginManifest } from './types.js';

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
