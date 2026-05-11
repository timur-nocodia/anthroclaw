import { join } from 'node:path';
import type {
  ContextEngine,
  PluginContext,
  PluginInstance,
} from './types-shim.js';
import { resolveConfig } from './config.js';
import { createHonchoClient } from './client.js';
import { observeHonchoTurn, type HonchoIngestSdk } from './ingest.js';
import { assembleHonchoContext, type HonchoContextSdk } from './context.js';
import { createHonchoTools, type HonchoToolSdk } from './tools.js';

export async function register(ctx: PluginContext): Promise<PluginInstance> {
  ctx.logger.info({ version: ctx.pluginVersion }, 'honcho plugin loading');

  const globalDefaults = readGlobalDefaults(ctx);
  const config = resolveConfig(globalDefaults, {});

  const engine: ContextEngine = {
    async assemble(input) {
      const agentConfig = ctx.getAgentConfig(input.agentId) as
        | { plugins?: { honcho?: unknown } }
        | undefined;
      const currentConfig = resolveConfig(globalDefaults, agentConfig?.plugins?.honcho ?? {});
      if (!currentConfig.enabled || (currentConfig.mode !== 'context' && currentConfig.mode !== 'hybrid')) {
        return null;
      }
      try {
        const client = await createHonchoClient(currentConfig);
        return await assembleHonchoContext({
          sdk: client.sdk as HonchoContextSdk,
          config: currentConfig,
          agentId: input.agentId,
          sessionKey: input.sessionKey,
          messages: input.messages,
        });
      } catch (err) {
        ctx.logger.warn(
          { err: err instanceof Error ? err.message : String(err), agentId: input.agentId },
          'honcho context assemble failed',
        );
        return null;
      }
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

  for (const tool of createHonchoTools({
    resolveConfig(agentId) {
      return resolveCurrentConfig(ctx, globalDefaults, agentId);
    },
    async resolveSdk(_agentId, currentConfig) {
      const client = await createHonchoClient(currentConfig);
      return client.sdk as HonchoToolSdk;
    },
  })) {
    ctx.registerMcpTool(tool);
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

function resolveCurrentConfig(ctx: PluginContext, globalDefaults: unknown, agentId: string) {
  const agentConfig = ctx.getAgentConfig(agentId) as
    | { plugins?: { honcho?: unknown } }
    | undefined;
  return resolveConfig(globalDefaults, agentConfig?.plugins?.honcho ?? {});
}
