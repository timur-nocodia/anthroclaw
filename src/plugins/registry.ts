import type { PluginManifest, PluginInstance, PluginMcpTool, ContextEngine, PluginSlashCommand } from './types.js';
import { logger } from '../logger.js';

interface PluginEntry {
  manifest: PluginManifest;
  instance: PluginInstance;
}

export class PluginRegistry {
  private plugins = new Map<string, PluginEntry>();
  private enabledByAgent = new Map<string, Set<string>>();
  private toolsByPlugin = new Map<string, PluginMcpTool[]>();
  private engineByPlugin = new Map<string, ContextEngine>();
  private commandsByPlugin = new Map<string, PluginSlashCommand[]>();

  // ─── Plugins ──────────────────────────────────────────────────────

  addPlugin(name: string, entry: PluginEntry): void {
    this.plugins.set(name, entry);
  }

  removePlugin(name: string): void {
    this.plugins.delete(name);
    this.toolsByPlugin.delete(name);
    this.engineByPlugin.delete(name);
    this.commandsByPlugin.delete(name);
    for (const enabled of this.enabledByAgent.values()) {
      enabled.delete(name);
    }
  }

  listPlugins(): PluginEntry[] {
    return [...this.plugins.values()];
  }

  // ─── Per-agent enable/disable ─────────────────────────────────────

  enableForAgent(agentId: string, pluginName: string): void {
    if (!this.plugins.has(pluginName)) {
      throw new Error(`cannot enable unknown plugin: ${pluginName}`);
    }
    const set = this.enabledByAgent.get(agentId) ?? new Set<string>();
    set.add(pluginName);
    this.enabledByAgent.set(agentId, set);
  }

  disableForAgent(agentId: string, pluginName: string): void {
    this.enabledByAgent.get(agentId)?.delete(pluginName);
  }

  isEnabledFor(agentId: string, pluginName: string): boolean {
    return this.enabledByAgent.get(agentId)?.has(pluginName) ?? false;
  }

  // ─── Tool registration ────────────────────────────────────────────

  addToolFromPlugin(pluginName: string, tool: PluginMcpTool): void {
    const tools = this.toolsByPlugin.get(pluginName) ?? [];
    tools.push(tool);
    this.toolsByPlugin.set(pluginName, tools);
  }

  /** Tools available to a specific agent — aggregated across all enabled plugins. */
  getMcpToolsForAgent(agentId: string): PluginMcpTool[] {
    const enabled = this.enabledByAgent.get(agentId);
    if (!enabled || enabled.size === 0) return [];
    const result: PluginMcpTool[] = [];
    for (const pluginName of enabled) {
      const tools = this.toolsByPlugin.get(pluginName);
      if (tools) result.push(...tools);
    }
    return result;
  }

  // ─── ContextEngine ────────────────────────────────────────────────

  addEngineFromPlugin(pluginName: string, engine: ContextEngine): void {
    if (this.engineByPlugin.has(pluginName)) {
      throw new Error(`plugin ${pluginName} already registered a ContextEngine`);
    }
    this.engineByPlugin.set(pluginName, engine);
  }

  /**
   * Active ContextEngine for an agent: last among enabled plugins with a registered engine.
   * If multiple — we take the last enabled (insertion-order Set) and log a warning.
   */
  getContextEngine(agentId: string): ContextEngine | null {
    const enabled = this.enabledByAgent.get(agentId);
    if (!enabled || enabled.size === 0) return null;

    const candidates: { name: string; engine: ContextEngine }[] = [];
    for (const pluginName of enabled) {
      const engine = this.engineByPlugin.get(pluginName);
      if (engine) candidates.push({ name: pluginName, engine });
    }
    if (candidates.length === 0) return null;
    if (candidates.length > 1) {
      logger.warn(
        { agentId, candidates: candidates.map(c => c.name) },
        'multiple ContextEngines enabled for agent; using last enabled'
      );
    }
    return candidates[candidates.length - 1].engine;
  }

  // ─── Slash commands ───────────────────────────────────────────────

  addCommandFromPlugin(pluginName: string, cmd: PluginSlashCommand): void {
    const cmds = this.commandsByPlugin.get(pluginName) ?? [];
    cmds.push(cmd);
    this.commandsByPlugin.set(pluginName, cmds);
  }

  listSlashCommands(): PluginSlashCommand[] {
    const result: PluginSlashCommand[] = [];
    for (const cmds of this.commandsByPlugin.values()) result.push(...cmds);
    return result;
  }
}
