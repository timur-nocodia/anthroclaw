import { z } from 'zod';
import type {
  ContextEngine,
  PluginContext,
  PluginInstance,
  PluginMcpTool,
} from './types-shim.js';
import { resolveConfig, type HonchoConfig } from './config.js';

export async function register(ctx: PluginContext): Promise<PluginInstance> {
  ctx.logger.info({ version: ctx.pluginVersion }, 'honcho plugin loading');

  const globalDefaults = readGlobalDefaults(ctx);
  const config = resolveConfig(globalDefaults, {});

  const engine: ContextEngine = {
    async assemble() {
      return null;
    },
  };
  ctx.registerContextEngine(engine);

  if (config.tools.status) {
    ctx.registerMcpTool(createStatusTool(config));
  }

  ctx.logger.info({ mode: config.mode }, 'honcho plugin loaded');
  return {
    shutdown() {
      ctx.logger.info({}, 'honcho plugin shutting down');
    },
    onAgentConfigChanged(agentId: string) {
      ctx.logger.debug({ agentId }, 'honcho per-agent config changed');
    },
  };
}

function readGlobalDefaults(ctx: PluginContext): unknown {
  const raw = ctx.getGlobalConfig() as
    | { plugins?: { honcho?: { defaults?: unknown } } }
    | undefined;
  return raw?.plugins?.honcho?.defaults ?? {};
}

function createStatusTool(config: HonchoConfig): PluginMcpTool {
  return {
    name: 'status',
    description: 'Report Honcho plugin runtime status for this agent.',
    inputSchema: z.object({}),
    async handler() {
      const host = new URL(config.connection.base_url).host;
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            enabled: config.enabled,
            mode: config.mode,
            workspace_id: config.connection.workspace_id,
            base_url_host: host,
            status: 'configured',
          }),
        }],
      };
    },
  };
}
