import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentMcpServerSpec } from '@anthropic-ai/claude-agent-sdk';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Agent } from '../agent/agent.js';
import { createListSkillsTool } from '../agent/tools/list-skills.js';
import { createMemorySearchTool } from '../agent/tools/memory-search.js';
import { createMemoryWikiTool } from '../agent/tools/memory-wiki.js';
import { createMemoryWriteTool } from '../agent/tools/memory-write.js';
import { createSessionSearchTool } from '../agent/tools/session-search.js';
import { createLocalNoteSearchTool } from '../agent/tools/local-note-search.js';
import type { ToolDefinition } from '../agent/tools/types.js';
import { createBraveSearchTool, createExaSearchTool } from '../agent/tools/web-search.js';
import type { GlobalConfig } from '../config/schema.js';
import { MemoryStore } from '../memory/store.js';
import { FileSessionStore } from './session-store.js';
import { SessionSearchService } from '../session/session-search.js';
import { TranscriptIndex } from '../session/transcript-index.js';

const PORTABLE_SUBAGENT_MCP_TOOLS = new Set([
  'memory_search',
  'session_search',
  'local_note_search',
  'memory_write',
  'memory_wiki',
  'list_skills',
  'web_search_brave',
  'web_search_exa',
]);

const SUBAGENT_MCP_ENV = {
  serverName: 'OPENCLAW_SUBAGENT_MCP_SERVER_NAME',
  agentId: 'OPENCLAW_SUBAGENT_MCP_AGENT_ID',
  workspacePath: 'OPENCLAW_SUBAGENT_MCP_WORKSPACE',
  dataDir: 'OPENCLAW_SUBAGENT_MCP_DATA_DIR',
  timezone: 'OPENCLAW_SUBAGENT_MCP_TIMEZONE',
  toolNames: 'OPENCLAW_SUBAGENT_MCP_TOOLS',
  braveApiKey: 'OPENCLAW_SUBAGENT_MCP_BRAVE_API_KEY',
  exaApiKey: 'OPENCLAW_SUBAGENT_MCP_EXA_API_KEY',
} as const;

type SubagentToolCarrier = Pick<Agent, 'id' | 'config' | 'workspacePath' | 'tools' | 'mcpServer'>;

export interface PortableSubagentMcpRuntime {
  serverName: string;
  agentId: string;
  workspacePath: string;
  dataDir: string;
  timezone: string;
  toolNames: string[];
  braveApiKey?: string;
  exaApiKey?: string;
}

export interface PortableSubagentMcpSpec {
  serverName: string;
  toolNames: string[];
  sourceToolNames: string[];
  skippedToolNames: string[];
  spec: AgentMcpServerSpec;
}

function portableToolNameSet(toolNames: readonly string[]): Set<string> {
  return new Set(
    toolNames
      .map((toolName) => toolName.split('__').at(-1) ?? toolName)
      .filter((toolName) => PORTABLE_SUBAGENT_MCP_TOOLS.has(toolName)),
  );
}

export function buildPortableSubagentMcpSpec(params: {
  agent: SubagentToolCarrier;
  allowedTools: readonly string[];
  dataDir: string;
  globalConfig?: GlobalConfig | null;
}): PortableSubagentMcpSpec | null {
  const approvedSourceToolNames = params.allowedTools
    .filter((toolName) => toolName.startsWith(`mcp__${params.agent.mcpServer.name}__`))
    .map((toolName) => toolName.split('__').at(-1) ?? toolName);

  if (approvedSourceToolNames.length === 0) {
    return null;
  }

  const portableApprovedToolNames = portableToolNameSet(approvedSourceToolNames);
  const sourceToolNames = params.agent.tools
    .map((tool) => tool.name)
    .filter((toolName) => portableApprovedToolNames.has(toolName));

  if (sourceToolNames.length === 0) {
    return null;
  }

  const skippedToolNames = approvedSourceToolNames.filter((toolName) => !sourceToolNames.includes(toolName));
  const serverName = `${params.agent.id}-subagent-tools`;
  const processSpec = resolvePortableSubagentMcpProcess();
  const env: Record<string, string> = {
    [SUBAGENT_MCP_ENV.serverName]: serverName,
    [SUBAGENT_MCP_ENV.agentId]: params.agent.id,
    [SUBAGENT_MCP_ENV.workspacePath]: params.agent.workspacePath,
    [SUBAGENT_MCP_ENV.dataDir]: params.dataDir,
    [SUBAGENT_MCP_ENV.timezone]: params.agent.config.timezone ?? 'UTC',
    [SUBAGENT_MCP_ENV.toolNames]: JSON.stringify(sourceToolNames),
  };

  if (sourceToolNames.includes('web_search_brave') && params.globalConfig?.brave?.api_key) {
    env[SUBAGENT_MCP_ENV.braveApiKey] = params.globalConfig.brave.api_key;
  }
  if (sourceToolNames.includes('web_search_exa') && params.globalConfig?.exa?.api_key) {
    env[SUBAGENT_MCP_ENV.exaApiKey] = params.globalConfig.exa.api_key;
  }

  return {
    serverName,
    sourceToolNames,
    skippedToolNames,
    toolNames: sourceToolNames.map((toolName) => `mcp__${serverName}__${toolName}`),
    spec: {
      [serverName]: {
        type: 'stdio',
        command: processSpec.command,
        args: processSpec.args,
        env,
      },
    },
  };
}

function resolvePortableSubagentMcpProcess(): { command: string; args: string[] } {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const distEntry = resolve(currentDir, '../../dist/cli/subagent-mcp-server.js');
  if (existsSync(distEntry)) {
    return { command: process.execPath, args: [distEntry] };
  }

  const sourceEntry = resolve(currentDir, '../cli/subagent-mcp-server.ts');
  return { command: process.execPath, args: ['--import', 'tsx', sourceEntry] };
}

function requireEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value) {
    throw new Error(`Missing required subagent MCP env var: ${key}`);
  }
  return value;
}

export function parsePortableSubagentMcpRuntime(
  env: NodeJS.ProcessEnv = process.env,
): PortableSubagentMcpRuntime {
  const rawToolNames = requireEnv(env, SUBAGENT_MCP_ENV.toolNames);
  const parsed = JSON.parse(rawToolNames);
  if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === 'string')) {
    throw new Error(`${SUBAGENT_MCP_ENV.toolNames} must be a JSON string array`);
  }

  return {
    serverName: requireEnv(env, SUBAGENT_MCP_ENV.serverName),
    agentId: requireEnv(env, SUBAGENT_MCP_ENV.agentId),
    workspacePath: requireEnv(env, SUBAGENT_MCP_ENV.workspacePath),
    dataDir: requireEnv(env, SUBAGENT_MCP_ENV.dataDir),
    timezone: env[SUBAGENT_MCP_ENV.timezone] ?? 'UTC',
    toolNames: parsed,
    braveApiKey: env[SUBAGENT_MCP_ENV.braveApiKey],
    exaApiKey: env[SUBAGENT_MCP_ENV.exaApiKey],
  };
}

export function createPortableSubagentTools(runtime: PortableSubagentMcpRuntime): ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  let memoryStore: MemoryStore | null = null;
  let sessionSearch: SessionSearchService | null = null;

  const getMemoryStore = (): MemoryStore => {
    if (!memoryStore) {
      const memoryDbDir = join(runtime.dataDir, 'memory-db');
      mkdirSync(memoryDbDir, { recursive: true });
      memoryStore = new MemoryStore(join(memoryDbDir, `${runtime.agentId}.sqlite`));
    }
    return memoryStore;
  };

  const getSessionSearch = (): SessionSearchService => {
    if (!sessionSearch) {
      const transcriptDbDir = join(runtime.dataDir, 'transcript-db');
      mkdirSync(transcriptDbDir, { recursive: true });
      sessionSearch = new SessionSearchService({
        projectKey: runtime.workspacePath,
        sessionStore: new FileSessionStore(join(runtime.dataDir, 'sdk-sessions')),
        transcriptIndex: new TranscriptIndex(join(transcriptDbDir, `${runtime.agentId}.sqlite`)),
      });
    }
    return sessionSearch;
  };

  for (const toolName of runtime.toolNames) {
    switch (toolName) {
      case 'memory_search':
        tools.push(createMemorySearchTool(getMemoryStore()));
        break;
      case 'session_search':
        tools.push(createSessionSearchTool(getSessionSearch()));
        break;
      case 'local_note_search':
        tools.push(createLocalNoteSearchTool(runtime.workspacePath));
        break;
      case 'memory_write':
        tools.push(createMemoryWriteTool(runtime.workspacePath, getMemoryStore(), runtime.timezone));
        break;
      case 'memory_wiki':
        tools.push(createMemoryWikiTool(runtime.workspacePath, getMemoryStore()));
        break;
      case 'list_skills':
        tools.push(createListSkillsTool(runtime.workspacePath));
        break;
      case 'web_search_brave':
        if (runtime.braveApiKey) {
          tools.push(createBraveSearchTool(runtime.braveApiKey));
        }
        break;
      case 'web_search_exa':
        if (runtime.exaApiKey) {
          tools.push(createExaSearchTool(runtime.exaApiKey));
        }
        break;
    }
  }

  return tools;
}

export async function startPortableSubagentMcpServer(
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const runtime = parsePortableSubagentMcpRuntime(env);
  const tools = createPortableSubagentTools(runtime);
  if (tools.length === 0) {
    throw new Error('No portable subagent MCP tools requested');
  }

  const server = new McpServer({
    name: runtime.serverName,
    version: '1.0.0',
  });

  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema as any,
      },
      async (args: Record<string, unknown>) => tool.handler((args ?? {}) as Record<string, unknown>) as any,
    );
  }

  const transport = new StdioServerTransport();
  const closed = new Promise<void>((resolve, reject) => {
    transport.onclose = () => resolve();
    transport.onerror = (error) => reject(error);
  });

  const shutdown = async () => {
    await transport.close().catch(() => {});
    await server.close().catch(() => {});
  };

  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());

  await server.connect(transport);

  try {
    await closed;
  } finally {
    await server.close().catch(() => {});
  }
}
