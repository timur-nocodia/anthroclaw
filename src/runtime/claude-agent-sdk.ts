import {
  createSdkMcpServer,
  query,
  startup,
} from '@anthropic-ai/claude-agent-sdk';
import type {
  AgentDefinition,
  AgentMcpServerSpec,
  ElicitationRequest,
  ElicitationResult,
  McpSdkServerConfigWithInstance,
  Options,
  Query,
  SDKUserMessage,
  WarmQuery,
} from '@anthropic-ai/claude-agent-sdk';
import { buildSdkOptions, type BuildSdkOptionsParams } from '../sdk/options.js';
import {
  DEFAULT_HEADLESS_TIMEOUT_MS,
  type HeadlessRunInput,
  type HeadlessRunResult,
  type HeadlessRuntime,
} from './headless.js';
import type {
  RuntimeAdapter,
  RuntimeMcpServerInput,
  RuntimeRewindFilesOptions,
  RuntimeRewindFilesResult,
  RuntimeRunHandle,
  RuntimeRunInput,
  RuntimeStartupInput,
} from './types.js';

export type ClaudeAgentDefinition = AgentDefinition;
export type ClaudeAgentMcpServerSpec = AgentMcpServerSpec;
export type ClaudeElicitationRequest = ElicitationRequest;
export type ClaudeElicitationResult = ElicitationResult;
export type ClaudeMcpSdkServerConfigWithInstance = McpSdkServerConfigWithInstance;
export type ClaudeRuntimeOptions = Options;
export type ClaudeRuntimeQuery = Query;
export type ClaudeRuntimeUserMessage = SDKUserMessage;
export type ClaudeWarmQuery = WarmQuery;
export type ClaudeBuildOptionsParams = BuildSdkOptionsParams;

export function buildClaudeRuntimeOptions(params: BuildSdkOptionsParams): Options {
  return buildSdkOptions(params);
}

export function runClaudeAgentQuery(input: RuntimeRunInput<Options>): Query {
  return query({
    prompt: input.prompt as string | AsyncIterable<SDKUserMessage>,
    options: input.options,
  }) as Query;
}

export class ClaudeRuntimeRunHandle implements RuntimeRunHandle<unknown> {
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
    options?: RuntimeRewindFilesOptions,
  ): Promise<RuntimeRewindFilesResult> {
    return this.query.rewindFiles(userMessageId, options);
  }
}

export function runClaudeAgentHandle(input: RuntimeRunInput<Options>): ClaudeRuntimeRunHandle {
  return new ClaudeRuntimeRunHandle(runClaudeAgentQuery(input));
}

export async function runClaudeHeadlessText(input: HeadlessRunInput): Promise<string> {
  const timeoutMs = input.timeoutMs ?? input.runtimeDefaults?.timeoutMs ?? DEFAULT_HEADLESS_TIMEOUT_MS;
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

export async function runClaudeHeadless(input: HeadlessRunInput): Promise<HeadlessRunResult> {
  return {
    text: await runClaudeHeadlessText(input),
  };
}

export async function startClaudeAgentRuntime(input: RuntimeStartupInput<Options>): Promise<WarmQuery> {
  return startup({ options: input.options });
}

export async function initializeClaudeAgentRuntime(): Promise<WarmQuery> {
  return startup();
}

export function createClaudeSdkMcpServer(input: RuntimeMcpServerInput): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: input.name,
    tools: input.tools as any[],
  });
}

export const claudeAgentSdkRuntime: RuntimeAdapter<Options, Query, WarmQuery, McpSdkServerConfigWithInstance> & {
  buildOptions(params: BuildSdkOptionsParams): Options;
} = {
  id: 'claude-agent-sdk',
  capabilities: {
    streaming: true,
    sessions: true,
    interrupt: true,
    approvals: true,
    mcp: true,
    subagents: true,
    checkpoints: true,
    warmStart: true,
  },
  buildOptions: buildClaudeRuntimeOptions,
  query: runClaudeAgentQuery,
  run: runClaudeAgentHandle,
  startup: startClaudeAgentRuntime,
  createMcpServer: createClaudeSdkMcpServer,
};

export const claudeAgentHeadlessRuntime: HeadlessRuntime = {
  id: 'claude-agent-sdk',
  run: runClaudeHeadless,
  runText: runClaudeHeadlessText,
};
