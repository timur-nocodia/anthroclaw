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
export { createPluginContext, type ContextDeps } from './context.js';
export { runSubagent } from './subagent-runner.js';
export { startPluginsWatcher, type PluginsWatcher, type WatcherCallbacks } from './watcher.js';
export { PluginManifestSchema, parsePluginManifest } from './manifest-schema.js';
