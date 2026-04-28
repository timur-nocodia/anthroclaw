/**
 * Local shim — re-declares only what the lcm plugin needs from PluginContext/PluginInstance.
 * This avoids importing from the gateway source tree, keeping the plugin truly self-contained.
 */

import type { z } from 'zod';

export interface PluginLogger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
  debug(obj: unknown, msg?: string): void;
}

export interface PluginMcpTool {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  handler: (input: unknown) => Promise<{ content: Array<{ type: 'text'; text: string }> }>;
}

export type HookEvent = string;
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
}

// ── ContextEngine surface (LCM implements this interface) ──────────────────

export interface ContextEngine {
  /**
   * Called before SDK query() — may transform the prompt payload.
   * Returns null if the plugin doesn't want to change anything.
   */
  assemble?(input: AssembleInput): Promise<AssembleResult | null>;

  /**
   * Called when compression threshold is exceeded — may return a compressed prompt payload.
   * Returns null to fall back to legacy compressor.
   */
  compress?(input: CompressInput): Promise<CompressResult | null>;

  /**
   * Optional override for "should we compress?" logic.
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
  messages: unknown[];           // transformed prompt
}

export interface ShouldCompressInput {
  agentId: string;
  sessionKey: string;
  messageCount: number;
  currentTokens: number;
}

// ── Slash commands ─────────────────────────────────────────────────────────

export interface PluginSlashCommand {
  name: string;                  // without leading slash
  description: string;
  handler: (args: string[], ctx: SlashCommandContext) => Promise<string>;
}

export interface SlashCommandContext {
  agentId: string;
  sessionKey: string;
}

// ── runSubagent ────────────────────────────────────────────────────────────

export interface RunSubagentOpts {
  prompt: string;
  systemPrompt?: string;
  model?: string;                // override agent's default
  timeoutMs?: number;            // default 60_000
  cwd?: string;
}
