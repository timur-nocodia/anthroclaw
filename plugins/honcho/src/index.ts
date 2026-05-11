import { z } from 'zod';
import { join } from 'node:path';
import type {
  ContextEngine,
  PluginContext,
  PluginInstance,
  PluginMcpTool,
} from './types-shim.js';
import { resolveConfig, type HonchoConfig } from './config.js';
import { createHonchoClient } from './client.js';
import { observeHonchoTurn, type HonchoIngestSdk } from './ingest.js';

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
  ctx.registerHook('on_after_query', async (payload) => {
    const agentId = typeof payload.agentId === 'string' ? payload.agentId : undefined;
    const sessionKey = typeof payload.sessionKey === 'string' ? payload.sessionKey : undefined;
    if (!agentId || !sessionKey) return;

    const agentConfig = ctx.getAgentConfig(agentId) as
      | { plugins?: { honcho?: unknown }; group_sessions?: 'shared' | 'per_user' }
      | undefined;
    const currentConfig = resolveConfig(globalDefaults, agentConfig?.plugins?.honcho ?? {});
    if (!currentConfig.enabled || currentConfig.mode === 'off') return;

    try {
      const client = await createHonchoClient(currentConfig);
      await observeHonchoTurn({
        sdk: client.sdk as HonchoIngestSdk,
        config: currentConfig,
        agentId,
        sessionKey,
        payload,
        groupSessionMode: agentConfig?.group_sessions,
        offlineQueuePath: join(ctx.dataDir, 'offline-queue', `${agentId}.jsonl`),
      });
    } catch (err) {
      ctx.logger.warn(
        { err: err instanceof Error ? err.message : String(err), agentId },
        'honcho observe hook failed',
      );
    }
  });

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
