/**
 * operator-console plugin entry point.
 *
 * Stage 3 — Task 17 stub. Tools and registration logic are filled in by
 * subsequent tasks (18–24). The shape mirrors plugins/lcm/src/index.ts.
 */

import type { PluginContext, PluginInstance } from './types-shim.js';

export async function register(ctx: PluginContext): Promise<PluginInstance> {
  ctx.logger.info({ version: ctx.pluginVersion }, 'operator-console plugin loading (stub)');
  return {
    shutdown: async () => {
      ctx.logger.info({}, 'operator-console plugin shutting down');
    },
  };
}
