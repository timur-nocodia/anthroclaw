// src/plugins/types.ts
import type { z } from 'zod';

/**
 * Manifest, как он лежит в plugins/{name}/.claude-plugin/plugin.json
 * после парсинга Zod-схемой (т.е. с дефолтами).
 */
export interface PluginManifest {
  name: string;
  version: string;
  description?: string;
  entry: string;                  // relative path to compiled JS
  configSchema?: string;          // optional path to Zod schema module
  mcpServers?: string;            // path to mcp.json (Claude Code Plugin Spec)
  skills?: string;                // dir of skills/*.md
  commands?: string;              // dir of commands/*.md
  hooks?: Record<string, string>; // event-name → handler-module-path (fire-and-forget only)
  requires?: {
    anthroclaw?: string;          // semver range
  };
}

/**
 * Контекст, передаваемый плагину в register(ctx).
 * Единственный API через который плагин общается с gateway.
 */
export interface PluginContext {
  pluginName: string;
  pluginVersion: string;
  dataDir: string;                // {anthroclaw-data-dir}/{plugin-name}/

  // Регистрация наблюдателей (fire-and-forget)
  registerHook(event: HookEvent, handler: HookHandler): void;

  // Регистрация MCP-тулов, которые плагин предоставляет агенту
  registerMcpTool(tool: PluginMcpTool): void;

  // Регистрация ContextEngine (для context-management плагинов вроде LCM)
  registerContextEngine(engine: ContextEngine): void;

  // Регистрация slash-команд
  registerSlashCommand(cmd: PluginSlashCommand): void;

  // Единственный способ LLM-вызова — через SDK query() с maxTurns:1, tools:[]
  runSubagent(opts: RunSubagentOpts): Promise<string>;

  logger: PluginLogger;

  getAgentConfig(agentId: string): unknown;     // Returns AgentYml — typed in registry
  getGlobalConfig(): unknown;                    // Returns GlobalConfig
}

export type HookEvent =
  | 'on_message_received'
  | 'on_before_query'
  | 'on_after_query'
  | 'on_session_reset'
  | 'on_tool_use'
  | 'on_tool_result';

export type HookHandler = (payload: Record<string, unknown>) => void | Promise<void>;

export interface PluginMcpTool {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  handler: (input: unknown) => Promise<{ content: Array<{ type: 'text'; text: string }> }>;
}

export interface PluginSlashCommand {
  name: string;                   // без слэша
  description: string;
  handler: (args: string[], ctx: SlashCommandContext) => Promise<string>;
}

export interface SlashCommandContext {
  agentId: string;
  sessionKey: string;
}

export interface ContextEngine {
  /**
   * Вызывается перед query() SDK — может трансформировать prompt-payload.
   * Возвращает null если плагин не хочет ничего менять.
   */
  assemble?(input: AssembleInput): Promise<AssembleResult | null>;

  /**
   * Вызывается когда threshold превышен — может вернуть сжатый prompt-payload.
   * Возвращает null чтобы откатиться на legacy compressor.
   */
  compress?(input: CompressInput): Promise<CompressResult | null>;

  /**
   * Optional override для логики "пора ли компактить".
   */
  shouldCompress?(input: ShouldCompressInput): boolean;
}

export interface AssembleInput {
  agentId: string;
  sessionKey: string;
  messages: unknown[];           // SDKMessage[] — typed via @anthropic-ai/claude-agent-sdk
}
export interface AssembleResult {
  messages: unknown[];           // transformed prompt
}

export interface CompressInput {
  agentId: string;
  sessionKey: string;
  messages: unknown[];
  currentTokens: number;
}
export interface CompressResult {
  assembled: unknown[];
}

export interface ShouldCompressInput {
  agentId: string;
  sessionKey: string;
  messageCount: number;
  currentTokens: number;
}

export interface RunSubagentOpts {
  prompt: string;
  systemPrompt?: string;
  model?: string;                 // override agent's default
  timeoutMs?: number;             // default 60_000
  cwd?: string;
}

export interface PluginLogger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
  debug(obj: unknown, msg?: string): void;
}

/**
 * Что экспортирует entry-модуль плагина.
 */
export interface PluginEntryModule {
  register: (ctx: PluginContext) => Promise<PluginInstance> | PluginInstance;
}

export interface PluginInstance {
  /** Освобождает ресурсы при unload (закрывает SQLite, etc). */
  shutdown?(): Promise<void> | void;
}
