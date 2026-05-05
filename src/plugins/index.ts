export type {
  PluginManifest,
  PluginContext,
  ContextEngine,
  PluginEntryModule,
  PluginInstance,
  PluginMcpTool,
  McpToolContext,
  PluginSlashCommand,
  SlashCommandContext,
  HookEvent,
  HookHandler,
  RunSubagentOpts,
  AssembleInput,
  AssembleResult,
  CompressInput,
  CompressResult,
  ShouldCompressInput,
  PluginLogger,
} from './types.js';

export { PluginRegistry } from './registry.js';
export { discoverPlugins, loadPlugin, type DiscoveredPlugin, type LoadPluginOpts } from './loader.js';
export {
  findDuplicatePluginNames,
  markDuplicateCatalogEntries,
  type PluginCatalogEntry,
  type PluginCatalogSourceType,
  type PluginCatalogStatus,
} from './catalog.js';
export {
  PluginInstallStore,
  PluginInstallRecordSchema,
  type PluginInstallRecord,
  type PluginInstallSourceType,
  type PluginInstallDependencyState,
  type PluginInstallStatus,
} from './install-store.js';
export {
  runPluginDoctor,
  type PluginDoctorResult,
} from './doctor.js';
export {
  installLocalPlugin,
  validatePluginSource,
  type InstallLocalPluginInput,
} from './installers/local.js';
export {
  installNpmPlugin,
  findPackedTarball,
} from './installers/npm.js';
export { discoverPluginCatalog, type PluginCatalog, type DiscoverPluginCatalogInput } from './discovery.js';
export { createPluginContext, type ContextDeps } from './context.js';
export { runSubagent } from './subagent-runner.js';
export { startPluginsWatcher, type PluginsWatcher, type WatcherCallbacks } from './watcher.js';
export { PluginManifestSchema, parsePluginManifest } from './manifest-schema.js';
