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

export interface PluginContext {
  pluginName: string;
  pluginVersion: string;
  dataDir: string;
  registerMcpTool(tool: PluginMcpTool): void;
  logger: PluginLogger;
  getAgentConfig(agentId: string): unknown;
}

export interface PluginInstance {
  shutdown?(): Promise<void> | void;
}
