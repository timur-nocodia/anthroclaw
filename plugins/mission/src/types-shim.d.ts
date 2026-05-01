import type { z } from 'zod';

export interface PluginLogger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
  debug(obj: unknown, msg?: string): void;
}

export interface McpToolContext {
  agentId: string;
  /** May be undefined for tools invoked outside a session-specific dispatch. */
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

export type HookEvent =
  | 'on_message_received'
  | 'on_before_query'
  | 'on_after_query'
  | 'on_session_reset'
  | 'on_cron_fire'
  | 'on_memory_write'
  | 'on_tool_use'
  | 'on_tool_result'
  | 'on_tool_error'
  | 'on_permission_request'
  | 'on_elicitation'
  | 'on_elicitation_result'
  | 'on_sdk_notification'
  | 'on_subagent_start'
  | 'on_subagent_stop';

export type HookHandler = (payload: Record<string, unknown>) => void | Promise<void>;

export interface PluginContext {
  pluginName: string;
  pluginVersion: string;
  dataDir: string;
  registerHook(event: HookEvent, handler: HookHandler): void;
  registerMcpTool(tool: PluginMcpTool): void;
  registerContextEngine(engine: ContextEngine): void;
  registerSlashCommand(cmd: PluginSlashCommand): void;
  runSubagent(opts: RunSubagentOpts): Promise<string>;
  logger: PluginLogger;
  getAgentConfig(agentId: string): unknown;
  getGlobalConfig(): unknown;
}

export interface PluginInstance {
  shutdown?(): Promise<void> | void;
  onAgentConfigChanged?(agentId: string): void | Promise<void>;
}

export interface ContextEngine {
  assemble?(input: AssembleInput): Promise<AssembleResult | null>;
  compress?(input: CompressInput): Promise<CompressResult | null>;
  shouldCompress?(input: ShouldCompressInput): boolean;
}

export interface AssembleInput {
  agentId: string;
  sessionKey: string;
  messages: unknown[];
}

export interface AssembleResult {
  messages: unknown[];
}

export interface CompressInput {
  agentId: string;
  sessionKey: string;
  messages: unknown[];
  currentTokens: number;
}

export interface CompressResult {
  messages: unknown[];
}

export interface ShouldCompressInput {
  agentId: string;
  sessionKey: string;
  messageCount: number;
  currentTokens: number;
}

export interface PluginSlashCommand {
  name: string;
  description: string;
  handler: (args: string[], ctx: SlashCommandContext) => Promise<string>;
}

export interface SlashCommandContext {
  agentId: string;
  sessionKey: string;
}

export interface RunSubagentOpts {
  prompt: string;
  systemPrompt?: string;
  model?: string;
  timeoutMs?: number;
  cwd?: string;
}
