import { z } from 'zod';
import { parseFileTransferConfig } from './config.js';
import { dirFetch, DirFetchInputSchema } from './tools/dir-fetch.js';
import { dirList, DirListInputSchema } from './tools/dir-list.js';
import { fileFetch, FileFetchInputSchema } from './tools/file-fetch.js';
import { fileWrite, FileWriteInputSchema } from './tools/file-write.js';
import type { McpToolContext, PluginContext, PluginInstance } from './types-shim.js';

export async function register(ctx: PluginContext): Promise<PluginInstance> {
  const configFor = (toolCtx: McpToolContext) => {
    const agentConfig = ctx.getAgentConfig(toolCtx.agentId);
    const rawPluginConfig = agentConfig &&
      typeof agentConfig === 'object' &&
      !Array.isArray(agentConfig)
      ? (agentConfig as { plugins?: Record<string, unknown> }).plugins?.['file-transfer']
      : undefined;
    return parseFileTransferConfig(rawPluginConfig);
  };

  ctx.registerMcpTool({
    name: 'file_fetch',
    description: 'Fetch a text file from configured file-transfer roots.',
    inputSchema: FileFetchInputSchema,
    handler: async (input, toolCtx) => jsonToolResult(await fileFetch(input, configFor(toolCtx))),
  });
  ctx.registerMcpTool({
    name: 'dir_list',
    description: 'List entries in a directory under configured file-transfer roots.',
    inputSchema: DirListInputSchema,
    handler: async (input, toolCtx) => jsonToolResult(await dirList(input, configFor(toolCtx))),
  });
  ctx.registerMcpTool({
    name: 'dir_fetch',
    description: 'Fetch small text files recursively from a configured directory root.',
    inputSchema: DirFetchInputSchema,
    handler: async (input, toolCtx) => jsonToolResult(await dirFetch(input, configFor(toolCtx))),
  });
  ctx.registerMcpTool({
    name: 'file_write',
    description: 'Write a text file under configured roots when allowWrite=true.',
    inputSchema: FileWriteInputSchema,
    handler: async (input, toolCtx) => jsonToolResult(await fileWrite(input, configFor(toolCtx))),
  });

  ctx.logger.info({}, 'file-transfer plugin registered');
  return {};
}

function jsonToolResult(value: unknown): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  return Promise.resolve({
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
  });
}

export const _schemas = {
  fileFetch: FileFetchInputSchema,
  dirList: DirListInputSchema,
  dirFetch: DirFetchInputSchema,
  fileWrite: FileWriteInputSchema,
  config: z.lazy(() => z.any()),
};
