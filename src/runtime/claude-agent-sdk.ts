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
import type { RuntimeAdapter, RuntimeMcpServerInput, RuntimeRunInput, RuntimeStartupInput } from './types.js';

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
  startup: startClaudeAgentRuntime,
  createMcpServer: createClaudeSdkMcpServer,
};
