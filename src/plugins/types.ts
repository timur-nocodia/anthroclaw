// src/plugins/types.ts
import type { z } from 'zod';
import type { HookEvent } from '../hooks/emitter.js';

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

  /**
   * Регистрирует slash-команду.
   * NOTE: As of Plan 1 (v0.1.0), commands are stored in the registry but
   * NOT dispatched anywhere. Dispatch wiring is deferred to Plan 2 — calling
   * this method currently has no observable effect at runtime. Tests in
   * registry.test.ts verify the registration mechanic.
   */
  registerSlashCommand(cmd: PluginSlashCommand): void;

  // Единственный способ LLM-вызова — через SDK query() с maxTurns:1, tools:[]
  runSubagent(opts: RunSubagentOpts): Promise<string>;

  logger: PluginLogger;

  getAgentConfig(agentId: string): unknown;     // Returns AgentYml — typed in registry
  getGlobalConfig(): unknown;                    // Returns GlobalConfig
}

export type { HookEvent } from '../hooks/emitter.js';

export type HookHandler = (payload: Record<string, unknown>) => void | Promise<void>;

/**
 * Context passed to MCP tool handlers at invocation time.
 *
 * Plugins that maintain per-agent state should resolve the right state
 * via `ctx.agentId` instead of binding to a single agent at register time.
 *
 * `sessionKey` is available for normal agent dispatches. It may be undefined
 * for tools called outside a session-specific query path.
 */
export interface McpToolContext {
  /** ID of the agent invoking this tool. Always present at runtime. */
  agentId: string;
  /** Session key, if known. May be undefined for tools called outside dispatch flow. */
  sessionKey?: string;
}

export interface PluginMcpTool {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  /**
   * Tool implementation. Receives the parsed input and a context object
   * with the calling agent's ID. Plugins that maintain per-agent state
   * should resolve the right state via `ctx.agentId` at invocation time.
   */
  handler: (
    input: unknown,
    ctx: McpToolContext,
  ) => Promise<{ content: Array<{ type: 'text'; text: string }> }>;
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
  /**
   * NOTE: When invoked from the gateway's auto-compress seam, this is `[]`
   * and `currentTokens` is `0`. Plugins that need message history must
   * mirror it themselves via the `on_after_query` hook — the gateway does
   * not retain SDK message arrays at the dispatch boundary.
   */
  messages: unknown[];
  currentTokens: number;
}
export interface CompressResult {
  messages: unknown[];           // transformed prompt
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

  /**
   * Optional: invoked when a specific agent's plugin config or enable state
   * changes (UI edit, hot-reload, etc). Plugins that cache per-agent state
   * (configs, DB handles, runtime objects) should invalidate their cache for
   * the given agentId so the next tool/hook invocation rebuilds with fresh
   * config from `ctx.getAgentConfig(agentId)`.
   *
   * Called AFTER the new config is persisted in agent.yml. May run async.
   * Errors are caught + logged by the gateway; never rethrown.
   */
  onAgentConfigChanged?(agentId: string): void | Promise<void>;
}
