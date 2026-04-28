/**
 * Local shim — re-declares only what the example plugin needs from PluginContext/PluginInstance.
 * This avoids importing from the gateway source tree, keeping the plugin truly self-contained.
 */

import type { z } from 'zod';

export interface PluginLogger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
  debug(obj: unknown, msg?: string): void;
}

export interface McpToolContext {
  agentId: string;
  sessionKey?: string;
}

export interface PluginMcpTool {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  handler: (
    input: unknown,
    ctx: McpToolContext,
  ) => Promise<{ content: Array<{ type: 'text'; text: string }> }>;
}

export type HookEvent = string;
export type HookHandler = (payload: Record<string, unknown>) => void | Promise<void>;

export interface PluginContext {
  pluginName: string;
  pluginVersion: string;
  dataDir: string;
  registerHook(event: HookEvent, handler: HookHandler): void;
  registerMcpTool(tool: PluginMcpTool): void;
  registerContextEngine(engine: unknown): void;
  registerSlashCommand(cmd: unknown): void;
  runSubagent(opts: unknown): Promise<string>;
  logger: PluginLogger;
  getAgentConfig(agentId: string): unknown;
  getGlobalConfig(): unknown;
}

export interface PluginInstance {
  shutdown?(): Promise<void> | void;
}
