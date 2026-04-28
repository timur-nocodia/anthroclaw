import { z } from 'zod';
import type { PluginContext, PluginInstance } from './types-shim.js';

export async function register(ctx: PluginContext): Promise<PluginInstance> {
  ctx.logger.info({}, 'example plugin registered');

  ctx.registerMcpTool({
    name: 'echo',
    description: 'Echoes input back. Used for plugin-framework tests.',
    inputSchema: z.object({ message: z.string() }),
    handler: async (input) => {
      const { message } = input as { message: string };
      return { content: [{ type: 'text' as const, text: `echo: ${message}` }] };
    },
  });

  ctx.registerHook('on_after_query', async (payload) => {
    ctx.logger.debug({ payload }, 'on_after_query');
  });

  return {
    shutdown: () => {
      ctx.logger.info({}, 'example plugin shutting down');
    },
  };
}
