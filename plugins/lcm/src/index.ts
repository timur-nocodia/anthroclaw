import type { PluginContext, PluginInstance } from './types-shim.js';

export async function register(ctx: PluginContext): Promise<PluginInstance> {
  ctx.logger.info({ version: ctx.pluginVersion }, 'LCM plugin registered (stub — Task 1 of Plan 2)');
  return {
    shutdown: () => {
      ctx.logger.info({}, 'LCM plugin shutting down');
    },
  };
}
