/**
 * Local shim — re-declares only what the operator-console plugin needs
 * from PluginContext/PluginInstance. Mirrors src/plugins/types.ts so the
 * plugin stays self-contained and decoupled from the gateway tree.
 */

import type { z } from 'zod';

export interface PluginLogger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
  debug(obj: unknown, msg?: string): void;
}

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

  // ── Operator-console-specific extensions (provided by gateway) ──
  /**
   * Per-agent peer-pause store handle. Plugins use this to pause/unpause/list
   * pause entries on managed agents. Optional — when absent (e.g. headless
   * tests), operator-console tools degrade gracefully.
   */
  getPeerPauseStore?(): unknown;
  /**
   * Notifications emitter handle for firing escalation_needed and similar
   * events on behalf of the calling agent.
   */
  getNotificationsEmitter?(): unknown;
  /**
   * Synthesise an inbound message for a target agent's session. Used by
   * `delegate_to_peer` to enqueue work for a managed agent without the
   * operator having to send a real chat message.
   */
  dispatchSyntheticInbound?(input: SyntheticInboundInput): Promise<SyntheticInboundResult>;
  /**
   * Run memory_search against a specific agent's memory store. Used by
   * `peer_summary` to surface what the managed agent already knows about
   * a given peer.
   */
  searchAgentMemory?(input: SearchAgentMemoryInput): Promise<SearchAgentMemoryResult>;
}

export interface SyntheticInboundInput {
  targetAgentId: string;
  channel: 'whatsapp' | 'telegram';
  accountId?: string;
  peerId: string;
  text: string;
  /** Free-form audit metadata stored on the synthetic message. */
  meta?: Record<string, unknown>;
}

export interface SyntheticInboundResult {
  messageId: string;
  sessionKey: string;
}

export interface SearchAgentMemoryInput {
  targetAgentId: string;
  query: string;
  maxResults?: number;
}

export interface SearchAgentMemoryResult {
  results: Array<{ path: string; snippet: string; score: number }>;
}

export interface PluginInstance {
  shutdown?(): Promise<void> | void;
  onAgentConfigChanged?(agentId: string): void | Promise<void>;
}

// ── ContextEngine surface (unused by operator-console but kept for parity) ──

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
