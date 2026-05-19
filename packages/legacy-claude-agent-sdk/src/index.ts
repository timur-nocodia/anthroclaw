import {
  createSdkMcpServer,
  deleteSession,
  forkSession,
  getSessionInfo,
  getSessionMessages,
  listSessions,
  query,
  startup,
  tool,
} from '@anthropic-ai/claude-agent-sdk';
import type {
  AgentDefinition,
  AgentMcpServerSpec,
  CanUseTool,
  ElicitationHookInput,
  ElicitationRequest,
  ElicitationResultHookInput,
  ElicitationResult,
  HookCallback,
  HookCallbackMatcher,
  HookEvent,
  HookInput,
  HookJSONOutput,
  McpHttpServerConfig,
  McpSdkServerConfigWithInstance,
  McpSSEServerConfig,
  McpStdioServerConfig,
  OnElicitation,
  Options,
  PermissionRequestHookInput,
  PermissionResult,
  PostToolUseFailureHookInput,
  PostToolUseHookInput,
  PreToolUseHookInput,
  Query,
  SDKSessionInfo,
  SDKUserMessage,
  SessionKey,
  SessionMessage,
  SessionStore,
  SessionStoreEntry,
  SubagentStartHookInput,
  SubagentStopHookInput,
  WarmQuery,
} from '@anthropic-ai/claude-agent-sdk';

export {
  createSdkMcpServer,
  deleteSession,
  forkSession,
  getSessionInfo,
  getSessionMessages,
  listSessions,
  query,
  startup,
  tool,
};

export type {
  AgentDefinition,
  AgentMcpServerSpec,
  CanUseTool,
  ElicitationHookInput,
  ElicitationRequest,
  ElicitationResultHookInput,
  ElicitationResult,
  HookCallback,
  HookCallbackMatcher,
  HookEvent,
  HookInput,
  HookJSONOutput,
  McpHttpServerConfig,
  McpSdkServerConfigWithInstance,
  McpSSEServerConfig,
  McpStdioServerConfig,
  OnElicitation,
  Options,
  PermissionRequestHookInput,
  PermissionResult,
  PostToolUseFailureHookInput,
  PostToolUseHookInput,
  PreToolUseHookInput,
  Query,
  SDKSessionInfo,
  SDKUserMessage,
  SessionKey,
  SessionMessage,
  SessionStore,
  SessionStoreEntry,
  SubagentStartHookInput,
  SubagentStopHookInput,
  WarmQuery,
};

export type ClaudeAgentDefinition = AgentDefinition;
export type ClaudeAgentMcpServerSpec = AgentMcpServerSpec;
export type ClaudeElicitationRequest = ElicitationRequest;
export type ClaudeElicitationResult = ElicitationResult;
export type ClaudeMcpSdkServerConfigWithInstance = McpSdkServerConfigWithInstance;
export type ClaudeRuntimeOptions = Options;
export type ClaudeRuntimeQuery = Query;
export type ClaudeRuntimeUserMessage = SDKUserMessage;
export type ClaudeWarmQuery = WarmQuery;

export interface LegacyHeadlessRunInput {
  prompt: string;
  cwd?: string;
  model?: string;
  systemPrompt?: string;
  purpose?: string;
  timeoutMs?: number;
  toolDenyMessage?: string;
  runtimeDefaults?: {
    cwd?: string;
    model?: string;
    timeoutMs?: number;
  };
}

export interface LegacyHeadlessRunResult {
  text: string;
  sessionId?: string;
}

export interface LegacyHeadlessRuntime {
  id: string;
  run(input: LegacyHeadlessRunInput): Promise<LegacyHeadlessRunResult>;
  runText(input: LegacyHeadlessRunInput): Promise<string>;
}

export interface LegacyRuntimeRunInput<TOptions = Options> {
  prompt: string | AsyncIterable<SDKUserMessage>;
  options: TOptions;
}

export interface LegacyRuntimeStartupInput<TOptions = Options> {
  options?: TOptions;
}

export interface LegacyRuntimeMcpServerInput {
  name: string;
  tools: unknown[];
}

export interface LegacyRuntimeRewindFilesOptions {
  dryRun?: boolean;
}

export interface LegacyRuntimeRewindFilesResult {
  canRewind: boolean;
  filesChanged?: string[];
  insertions?: number;
  deletions?: number;
  error?: string;
}

export interface LegacyRuntimeRunHandle<TEvent = unknown> extends AsyncIterable<TEvent> {
  interrupt(): Promise<void>;
  close?(): void;
  rewindFiles(
    userMessageId: string,
    options?: LegacyRuntimeRewindFilesOptions,
  ): Promise<LegacyRuntimeRewindFilesResult>;
}

export const DEFAULT_LEGACY_HEADLESS_TIMEOUT_MS = 60_000;

const CLAUDE_AUTH_FAILURE_PATTERNS = [
  /failed to authenticate/i,
  /authentication_error/i,
  /invalid authentication credentials/i,
];

function looksLikeClaudeAuthFailure(text: string): boolean {
  return CLAUDE_AUTH_FAILURE_PATTERNS.some((pattern) => pattern.test(text));
}

export function runClaudeAgentQuery(input: LegacyRuntimeRunInput<Options>): Query {
  return query({
    prompt: input.prompt as string | AsyncIterable<SDKUserMessage>,
    options: input.options,
  }) as Query;
}

export class ClaudeRuntimeRunHandle implements LegacyRuntimeRunHandle<unknown> {
  constructor(readonly query: Query) {}

  [Symbol.asyncIterator](): AsyncIterator<unknown> {
    return this.query[Symbol.asyncIterator]() as AsyncIterator<unknown>;
  }

  async interrupt(): Promise<void> {
    await this.query.interrupt();
  }

  close(): void {
    this.query.close?.();
  }

  async rewindFiles(
    userMessageId: string,
    options?: LegacyRuntimeRewindFilesOptions,
  ): Promise<LegacyRuntimeRewindFilesResult> {
    return this.query.rewindFiles(userMessageId, options);
  }
}

export function runClaudeAgentHandle(input: LegacyRuntimeRunInput<Options>): ClaudeRuntimeRunHandle {
  return new ClaudeRuntimeRunHandle(runClaudeAgentQuery(input));
}

export async function runClaudeHeadlessText(input: LegacyHeadlessRunInput): Promise<string> {
  const timeoutMs = input.timeoutMs ?? input.runtimeDefaults?.timeoutMs ?? DEFAULT_LEGACY_HEADLESS_TIMEOUT_MS;
  const controller = new AbortController();
  const purpose = input.purpose ?? 'headless review';

  const sdkOptions: Options = {
    model: input.model ?? input.runtimeDefaults?.model ?? 'claude-sonnet-4-6',
    cwd: input.cwd ?? input.runtimeDefaults?.cwd ?? process.cwd(),
    tools: [],
    allowedTools: [],
    permissionMode: 'dontAsk',
    canUseTool: async () => ({
      behavior: 'deny',
      message: input.toolDenyMessage ?? `Tools disabled for ${purpose}.`,
    }),
    abortController: controller,
    settingSources: ['project'],
    persistSession: false,
    maxTurns: 1,
    systemPrompt: input.systemPrompt
      ? { type: 'preset', preset: 'claude_code', excludeDynamicSections: true, append: input.systemPrompt }
      : { type: 'preset', preset: 'claude_code', excludeDynamicSections: true },
  };

  const stream = runClaudeAgentQuery({ prompt: input.prompt, options: sdkOptions });
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let result = '';
  let resultFound = false;
  const accumulated: string[] = [];

  const completePromise = (async () => {
    for await (const evt of stream) {
      const e = evt as Record<string, unknown>;

      const subtype = (e as { subtype?: string }).subtype ?? 'unknown';
      const isErrorResult = e.type === 'result'
        && Boolean((e as { is_error?: boolean }).is_error)
        && subtype !== 'success';
      if (isErrorResult) {
        const errors = (e as { errors?: string[] }).errors ?? [];
        throw new Error(`${purpose} LLM error (${subtype}): ${errors.join('; ') || subtype}`);
      }

      if (e.type === 'result' && typeof e.result === 'string') {
        result = e.result.trim();
        if (looksLikeClaudeAuthFailure(result)) {
          throw new Error(`${purpose} LLM authentication error: ${result}`);
        }
        resultFound = true;
        break;
      }

      if (e.type === 'assistant') {
        const msg = e.message as { content?: Array<{ type?: string; text?: string }> } | undefined;
        if (!msg?.content) continue;
        for (const block of msg.content) {
          if (block.type === 'text' && typeof block.text === 'string') {
            accumulated.push(block.text);
          }
        }
      }
    }
  })();

  const timeoutPromise = new Promise<never>((_, reject) => {
    controller.signal.addEventListener('abort', () => {
      reject(new Error(`${purpose} timeout after ${timeoutMs}ms`));
    });
  });

  try {
    await Promise.race([completePromise, timeoutPromise]);
  } finally {
    clearTimeout(timer);
    stream.close?.();
  }

  if (!resultFound) {
    result = accumulated.join('').trim();
  }

  if (!result) {
    throw new Error(`${purpose} returned empty result`);
  }

  return result;
}

export async function runClaudeHeadless(input: LegacyHeadlessRunInput): Promise<LegacyHeadlessRunResult> {
  return {
    text: await runClaudeHeadlessText(input),
  };
}

export async function startClaudeAgentRuntime(input: LegacyRuntimeStartupInput<Options>): Promise<WarmQuery> {
  return startup({ options: input.options });
}

export async function initializeClaudeAgentRuntime(): Promise<WarmQuery> {
  return startup();
}

export function createClaudeSdkMcpServer(input: LegacyRuntimeMcpServerInput): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: input.name,
    tools: input.tools as any[],
  });
}

export const claudeAgentHeadlessRuntime: LegacyHeadlessRuntime = {
  id: 'claude-agent-sdk',
  run: runClaudeHeadless,
  runText: runClaudeHeadlessText,
};
