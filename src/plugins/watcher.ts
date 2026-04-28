import chokidar from 'chokidar';
import { dirname, basename } from 'node:path';
import { realpathSync } from 'node:fs';
import { discoverPlugins, type DiscoveredPlugin } from './loader.js';
import { logger } from '../logger.js';

export interface WatcherCallbacks {
  onAdd: (plugin: DiscoveredPlugin) => void | Promise<void>;
  onRemove: (pluginName: string) => void | Promise<void>;
}

export interface PluginsWatcher {
  close(): Promise<void>;
}

/** Returns true only for paths matching {pluginsDir}/{name}/.claude-plugin/plugin.json */
function isPluginManifest(path: string): boolean {
  // path segments from end: plugin.json / .claude-plugin / <name> / ...
  const parts = path.replace(/\\/g, '/').split('/');
  return (
    parts.at(-1) === 'plugin.json' &&
    parts.at(-2) === '.claude-plugin'
  );
}

export function startPluginsWatcher(
  pluginsDir: string,
  callbacks: WatcherCallbacks,
): PluginsWatcher {
  // Resolve real path to handle macOS /var -> /private/var symlinks
  let resolvedPluginsDir: string;
  try {
    resolvedPluginsDir = realpathSync(pluginsDir);
  } catch {
    resolvedPluginsDir = pluginsDir;
  }

  // Watch the plugins directory with depth=3 so we catch newly created subdirectories.
  // We cannot use a glob like `dir/*/.claude-plugin/plugin.json` because chokidar
  // does not pick up dynamically-created intermediate directories on macOS with that
  // pattern — watching the parent dir with depth is more reliable.
  const watcher = chokidar.watch(resolvedPluginsDir, {
    persistent: true,
    ignoreInitial: true,
    depth: 3,
  });

  watcher.on('add', async (path) => {
    if (!isPluginManifest(path)) return;
    logger.debug({ path }, 'plugin manifest added');
    const pluginDirName = basename(dirname(dirname(path)));
    try {
      const all = await discoverPlugins(pluginsDir);
      const found = all.find(p => p.manifest.name === pluginDirName)
        ?? all.find(p => p.pluginDir.endsWith(`/${pluginDirName}`));
      if (found) await callbacks.onAdd(found);
    } catch (err) {
      logger.warn({ err, path }, 'failed to handle plugin add');
    }
  });

  watcher.on('change', async (path) => {
    if (!isPluginManifest(path)) return;
    logger.debug({ path }, 'plugin manifest changed, reloading');
    const pluginDirName = basename(dirname(dirname(path)));
    try {
      await callbacks.onRemove(pluginDirName);
      const all = await discoverPlugins(pluginsDir);
      const found = all.find(p => p.manifest.name === pluginDirName)
        ?? all.find(p => p.pluginDir.endsWith(`/${pluginDirName}`));
      if (found) await callbacks.onAdd(found);
    } catch (err) {
      logger.warn({ err, path }, 'failed to handle plugin change');
    }
  });

  watcher.on('unlink', async (path) => {
    if (!isPluginManifest(path)) return;
    logger.debug({ path }, 'plugin manifest removed');
    const pluginDirName = basename(dirname(dirname(path)));
    try {
      await callbacks.onRemove(pluginDirName);
    } catch (err) {
      logger.warn({ err, path }, 'failed to handle plugin remove');
    }
  });

  return {
    close: () => watcher.close(),
  };
}
