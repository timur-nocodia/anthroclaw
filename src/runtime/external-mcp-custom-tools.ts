import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { AgentYml } from '../config/schema.js';
import type {
  HeadlessCustomTool,
  HeadlessCustomToolContent,
  HeadlessCustomToolResult,
} from './headless.js';

type ExternalMcpServers = NonNullable<AgentYml['external_mcp_servers']>;
type ExternalMcpServer = ExternalMcpServers[string];

export interface ExternalMcpListedTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface ExternalMcpToolClientContext {
  cwd: string;
  requestTimeoutMs: number;
  clientName: string;
}

export interface ExternalMcpToolClient {
  listTools(
    serverName: string,
    server: ExternalMcpServer,
    context: ExternalMcpToolClientContext,
  ): Promise<ExternalMcpListedTool[]>;
  callTool(
    serverName: string,
    server: ExternalMcpServer,
    toolName: string,
    args: Record<string, unknown>,
    context: ExternalMcpToolClientContext,
  ): Promise<unknown>;
}

export interface BuildExternalMcpCustomToolsOptions {
  servers: ExternalMcpServers | undefined;
  cwd: string;
  requestTimeoutMs?: number;
  clientName?: string;
  client?: ExternalMcpToolClient;
  onError?: (error: Error, context: { serverName: string; phase: 'list' | 'call'; toolName?: string }) => void;
}

const DEFAULT_MCP_REQUEST_TIMEOUT_MS = 60_000;

export async function buildExternalMcpCustomTools(
  options: BuildExternalMcpCustomToolsOptions,
): Promise<HeadlessCustomTool[]> {
  const servers = options.servers ?? {};
  const client = options.client ?? sdkExternalMcpToolClient;
  const context: ExternalMcpToolClientContext = {
    cwd: options.cwd,
    requestTimeoutMs: options.requestTimeoutMs ?? DEFAULT_MCP_REQUEST_TIMEOUT_MS,
    clientName: options.clientName ?? 'anthroclaw-pi-gateway',
  };
  const tools: HeadlessCustomTool[] = [];

  for (const [serverName, server] of Object.entries(servers)) {
    const allowed = new Set(server.allowed_tools ?? []);
    if (allowed.size === 0) continue;

    let listed: ExternalMcpListedTool[];
    try {
      listed = await client.listTools(serverName, server, context);
    } catch (err) {
      options.onError?.(asError(err), { serverName, phase: 'list' });
      continue;
    }

    for (const tool of listed) {
      if (!allowed.has(tool.name)) continue;
      const customToolName = externalMcpCustomToolName(serverName, tool.name);
      tools.push({
        name: customToolName,
        description: tool.description
          ? `[MCP:${serverName}] ${tool.description}`
          : `[MCP:${serverName}] ${tool.name}`,
        inputSchema: normalizeInputSchema(tool.inputSchema),
        handler: async (args) => {
          try {
            return normalizeExternalMcpToolResult(await client.callTool(
              serverName,
              server,
              tool.name,
              args,
              context,
            ), {
              serverName,
              toolName: tool.name,
              customToolName,
            });
          } catch (err) {
            options.onError?.(asError(err), { serverName, phase: 'call', toolName: tool.name });
            return {
              content: [{ type: 'text', text: `MCP tool ${serverName}.${tool.name} failed: ${asError(err).message}` }],
              isError: true,
              details: {
                serverName,
                toolName: tool.name,
                customToolName,
              },
            };
          }
        },
      });
    }
  }

  return tools;
}

export function externalMcpCustomToolName(serverName: string, toolName: string): string {
  return `mcp__${serverName}__${toolName}`;
}

export const sdkExternalMcpToolClient: ExternalMcpToolClient = {
  async listTools(serverName, server, context) {
    return withExternalMcpClient(serverName, server, context, async (client) => {
      const result = await client.listTools(undefined, { timeout: context.requestTimeoutMs });
      return result.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }));
    });
  },

  async callTool(serverName, server, toolName, args, context) {
    return withExternalMcpClient(serverName, server, context, (client) => (
      client.callTool(
        { name: toolName, arguments: args },
        undefined,
        { timeout: context.requestTimeoutMs },
      )
    ));
  },
};

async function withExternalMcpClient<T>(
  serverName: string,
  server: ExternalMcpServer,
  context: ExternalMcpToolClientContext,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const transport = createExternalMcpTransport(server, context);
  const client = new Client({
    name: context.clientName,
    version: '1.0.0',
  }, {
    capabilities: {},
  });

  try {
    await client.connect(transport, { timeout: context.requestTimeoutMs });
    return await fn(client);
  } catch (err) {
    throw new Error(`external MCP ${serverName}: ${asError(err).message}`);
  } finally {
    await client.close().catch(() => undefined);
  }
}

function createExternalMcpTransport(
  server: ExternalMcpServer,
  context: ExternalMcpToolClientContext,
): Transport {
  if (server.type === 'http') {
    return new StreamableHTTPClientTransport(new URL(server.url), {
      requestInit: requestInitWithHeaders(server.headers),
    });
  }

  if (server.type === 'sse') {
    const headers = server.headers;
    return new SSEClientTransport(new URL(server.url), {
      requestInit: requestInitWithHeaders(headers),
      eventSourceInit: headers
        ? {
            fetch: (url: string | URL, init?: RequestInit) => fetch(url, mergeRequestInitHeaders(init, headers)),
          } as never
        : undefined,
    });
  }

  return new StdioClientTransport({
    command: server.command,
    args: server.args ? [...server.args] : undefined,
    env: server.env
      ? { ...getDefaultEnvironment(), ...server.env }
      : undefined,
    cwd: context.cwd,
    stderr: 'pipe',
  });
}

function requestInitWithHeaders(headers: Record<string, string> | undefined): RequestInit | undefined {
  if (!headers || Object.keys(headers).length === 0) return undefined;
  return { headers: { ...headers } };
}

function mergeRequestInitHeaders(
  init: RequestInit | undefined,
  headers: Record<string, string>,
): RequestInit {
  return {
    ...(init ?? {}),
    headers: {
      ...headersToRecord(init?.headers),
      ...headers,
    },
  };
}

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return { ...headers };
}

function normalizeInputSchema(schema: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!schema || schema.type !== 'object') {
    return {
      type: 'object',
      additionalProperties: true,
    };
  }
  return schema;
}

function normalizeExternalMcpToolResult(
  result: unknown,
  details: { serverName: string; toolName: string; customToolName: string },
): HeadlessCustomToolResult {
  if (!isRecord(result)) {
    return {
      content: [{ type: 'text', text: JSON.stringify(result ?? null) }],
      details,
    };
  }

  if ('toolResult' in result) {
    return {
      content: [{ type: 'text', text: JSON.stringify(result.toolResult ?? null) }],
      details: {
        ...details,
        meta: isRecord(result._meta) ? result._meta : undefined,
      },
    };
  }

  return {
    content: normalizeMcpContent(result.content),
    ...(result.isError === true ? { isError: true } : {}),
    details: {
      ...details,
      structuredContent: isRecord(result.structuredContent) ? result.structuredContent : undefined,
      meta: isRecord(result._meta) ? result._meta : undefined,
    },
  };
}

function normalizeMcpContent(content: unknown): HeadlessCustomToolContent[] {
  if (!Array.isArray(content) || content.length === 0) {
    return [{ type: 'text', text: '' }];
  }
  return content.map((item) => {
    if (!isRecord(item)) return { type: 'text', text: JSON.stringify(item) };
    if (typeof item.type !== 'string' || !item.type) {
      return { type: 'text', text: JSON.stringify(item) };
    }
    if (item.type === 'text' && typeof item.text !== 'string') {
      return { ...item, type: 'text', text: JSON.stringify(item.text ?? '') };
    }
    return item as HeadlessCustomToolContent;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}
