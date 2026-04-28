import type {
  PluginContext,
  PluginMcpTool,
  ContextEngine,
  PluginSlashCommand,
  HookEvent,
  HookHandler,
  RunSubagentOpts,
  PluginLogger,
} from './types.js';
import { runSubagent as runSubagentImpl } from './subagent-runner.js';

export interface ContextDeps {
  pluginName: string;
  pluginVersion: string;
  dataDir: string;

  /** Root pino-style logger — child adds { plugin: name } to every log entry. */
  rootLogger: PluginLogger;

  /**
   * Store a hook registration and subscribe to all current agent emitters.
   * Gateway-provided callback — handles both persistence and fan-out.
   */
  registerHook(pluginName: string, event: HookEvent, handler: HookHandler): void;

  /** Register an MCP tool in the plugin registry — it will be served to agents via per-agent MCP server. */
  registerTool(tool: PluginMcpTool): void;

  /** Register a ContextEngine — gateway will call it for compress/assemble. */
  registerEngine(pluginName: string, engine: ContextEngine): void;

  /** Register a slash command. */
  registerCommand(cmd: PluginSlashCommand): void;

  getAgentConfig(agentId: string): unknown;
  getGlobalConfig(): unknown;
}

export function createPluginContext(deps: ContextDeps): PluginContext {
  // Prefix tool name with plugin name to guarantee uniqueness across plugins.
  const namespace = (toolName: string) => `${deps.pluginName}_${toolName}`;

  const childLogger: PluginLogger = {
    info: (obj, msg) =>
      deps.rootLogger.info({ plugin: deps.pluginName, ...((obj as object) ?? {}) }, msg),
    warn: (obj, msg) =>
      deps.rootLogger.warn({ plugin: deps.pluginName, ...((obj as object) ?? {}) }, msg),
    error: (obj, msg) =>
      deps.rootLogger.error({ plugin: deps.pluginName, ...((obj as object) ?? {}) }, msg),
    debug: (obj, msg) =>
      deps.rootLogger.debug({ plugin: deps.pluginName, ...((obj as object) ?? {}) }, msg),
  };

  return {
    pluginName: deps.pluginName,
    pluginVersion: deps.pluginVersion,
    dataDir: deps.dataDir,
    logger: childLogger,

    registerHook(event: HookEvent, handler: HookHandler): void {
      // Delegate entirely to the gateway-provided callback which:
      // 1. Persists the registration in PluginRegistry (for hot-reload resubscription).
      // 2. Subscribes handler to all current agent emitters immediately.
      deps.registerHook(deps.pluginName, event, handler);
    },

    registerMcpTool(tool: PluginMcpTool): void {
      const namespaced: PluginMcpTool = { ...tool, name: namespace(tool.name) };
      deps.registerTool(namespaced);
    },

    registerContextEngine(engine: ContextEngine): void {
      deps.registerEngine(deps.pluginName, engine);
    },

    registerSlashCommand(cmd: PluginSlashCommand): void {
      deps.registerCommand(cmd);
    },

    runSubagent(opts: RunSubagentOpts): Promise<string> {
      return runSubagentImpl(opts);
    },

    getAgentConfig(agentId: string): unknown {
      return deps.getAgentConfig(agentId);
    },

    getGlobalConfig(): unknown {
      return deps.getGlobalConfig();
    },
  };
}
