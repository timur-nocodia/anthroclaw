import {
  claudeAgentHeadlessRuntime as legacyClaudeAgentHeadlessRuntime,
  createSdkMcpServer,
  query,
  startup,
} from '@anthroclaw/legacy-claude-agent-sdk';
import type {
  ClaudeAgentDefinition,
  ClaudeAgentMcpServerSpec,
  ClaudeElicitationRequest,
  ClaudeElicitationResult,
  ClaudeMcpSdkServerConfigWithInstance,
  ClaudeRuntimeOptions,
  ClaudeRuntimeQuery,
  ClaudeRuntimeUserMessage,
  ClaudeWarmQuery,
  LegacyHeadlessRunInput,
  LegacyHeadlessRunResult,
  LegacyRuntimeRewindFilesOptions,
  LegacyRuntimeRewindFilesResult,
} from '@anthroclaw/legacy-claude-agent-sdk';
import { buildSdkOptions, type BuildSdkOptionsParams } from '../sdk/options.js';
import type { HeadlessRuntime } from './headless.js';
import type { RuntimeAdapter } from './types.js';

export type {
  ClaudeAgentDefinition,
  ClaudeAgentMcpServerSpec,
  ClaudeElicitationRequest,
  ClaudeElicitationResult,
  ClaudeMcpSdkServerConfigWithInstance,
  ClaudeRuntimeOptions,
  ClaudeRuntimeQuery,
  ClaudeRuntimeUserMessage,
  ClaudeWarmQuery,
};
export type ClaudeBuildOptionsParams = BuildSdkOptionsParams;

export class ClaudeRuntimeRunHandle implements AsyncIterable<unknown> {
  constructor(readonly query: ClaudeRuntimeQuery) {}

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

export function buildClaudeRuntimeOptions(params: BuildSdkOptionsParams): ClaudeRuntimeOptions {
  return buildSdkOptions(params);
}

export function runClaudeAgentQuery(input: {
  prompt: string | AsyncIterable<ClaudeRuntimeUserMessage>;
  options: ClaudeRuntimeOptions;
}): ClaudeRuntimeQuery {
  return query({
    prompt: input.prompt,
    options: input.options,
  }) as ClaudeRuntimeQuery;
}

export function runClaudeAgentHandle(input: {
  prompt: string | AsyncIterable<ClaudeRuntimeUserMessage>;
  options: ClaudeRuntimeOptions;
}): ClaudeRuntimeRunHandle {
  return new ClaudeRuntimeRunHandle(runClaudeAgentQuery(input));
}

export async function startClaudeAgentRuntime(input: {
  options?: ClaudeRuntimeOptions;
}): Promise<ClaudeWarmQuery> {
  return startup({ options: input.options });
}

export async function initializeClaudeAgentRuntime(): Promise<ClaudeWarmQuery> {
  return startup();
}

export function createClaudeSdkMcpServer(input: {
  name: string;
  tools: unknown[];
}): ClaudeMcpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: input.name,
    tools: input.tools as any[],
  });
}

export async function runClaudeHeadless(input: LegacyHeadlessRunInput): Promise<LegacyHeadlessRunResult> {
  if (legacyClaudeAgentHeadlessRuntime.run) return legacyClaudeAgentHeadlessRuntime.run(input);
  return {
    text: await legacyClaudeAgentHeadlessRuntime.runText(input),
  };
}

export async function runClaudeHeadlessText(input: LegacyHeadlessRunInput): Promise<string> {
  return legacyClaudeAgentHeadlessRuntime.runText(input);
}

export const claudeAgentSdkRuntime: RuntimeAdapter<
  ClaudeRuntimeOptions,
  ClaudeRuntimeQuery,
  ClaudeWarmQuery,
  ClaudeMcpSdkServerConfigWithInstance
> & {
  buildOptions(params: BuildSdkOptionsParams): ClaudeRuntimeOptions;
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

export const claudeAgentHeadlessRuntime: HeadlessRuntime = legacyClaudeAgentHeadlessRuntime;
