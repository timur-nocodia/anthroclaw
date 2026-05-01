/**
 * operator-console plugin entry point.
 *
 * Registers up to 5 MCP tools (peer_pause, delegate_to_peer, list_active_peers,
 * peer_summary, escalate) against the gateway. Per-agent gating
 * (`enabled`, `manages`, `capabilities`) is enforced at call time via
 * `ctx.getAgentConfig(ctx.agentId)` — the same agent that calls a tool
 * decides its own permissions.
 *
 * Required gateway plumbing on PluginContext (all optional):
 *   - getPeerPauseStore(): used by peer_pause and list_active_peers
 *   - getNotificationsEmitter(): used by escalate
 *   - dispatchSyntheticInbound(): used by delegate_to_peer
 *   - searchAgentMemory(): used by peer_summary
 *
 * When a piece of plumbing is missing, the corresponding tool returns a
 * graceful error rather than crashing the agent.
 */

import type {
  PluginContext,
  PluginInstance,
  PluginMcpTool,
  McpToolContext,
  SyntheticInboundInput,
  SyntheticInboundResult,
  SearchAgentMemoryInput,
  SearchAgentMemoryResult,
} from './types-shim.js';
import {
  resolveConfig,
  type CapabilityName,
  type OperatorConsoleConfig,
} from './config.js';
import { createPeerPauseTool, type PauseStoreLike } from './tools/peer-pause.js';
import { createDelegateTool } from './tools/delegate-to-peer.js';
import { createListActivePeersTool } from './tools/list-active-peers.js';
import { createPeerSummaryTool } from './tools/peer-summary.js';
import { createEscalateTool, type NotificationsEmitterLike } from './tools/escalate.js';

interface ToolDescriptor {
  capability: CapabilityName;
  /** Build the underlying MCP tool. The wrapper around it adds per-call gating. */
  build: (config: OperatorConsoleConfig, agentId: string) => PluginMcpTool;
}

export async function register(ctx: PluginContext): Promise<PluginInstance> {
  ctx.logger.info({ version: ctx.pluginVersion }, 'operator-console plugin loading');

  // Resolve a baseline config from globalConfig.plugins['operator-console'].
  // This determines which tools we *register* with the gateway. Per-agent
  // overrides (enabled, manages, capabilities) refine permission decisions
  // at call time.
  const globalCfg = readGlobalConfig(ctx);

  // ── Plumbing handles ─────────────────────────────────────────────────
  // Provided by the gateway via PluginContext extensions; absent in
  // headless tests. Each tool handles a missing handle gracefully.
  const pauseStore = (ctx.getPeerPauseStore?.() ?? null) as PauseStoreLike | null;
  const notificationsEmitter =
    (ctx.getNotificationsEmitter?.() ?? null) as NotificationsEmitterLike | null;
  const dispatchSynthetic =
    ctx.dispatchSyntheticInbound
      ? (input: SyntheticInboundInput): Promise<SyntheticInboundResult> =>
          ctx.dispatchSyntheticInbound!(input)
      : null;
  const searchAgentMemory =
    ctx.searchAgentMemory
      ? (input: SearchAgentMemoryInput): Promise<SearchAgentMemoryResult> =>
          ctx.searchAgentMemory!(input)
      : null;

  // ── Tool descriptors ─────────────────────────────────────────────────
  const descriptors: ToolDescriptor[] = [
    {
      capability: 'peer_pause',
      build: (cfg) =>
        createPeerPauseTool({
          pauseStore,
          config: cfg,
          logger: ctx.logger as never,
        }),
    },
    {
      capability: 'delegate',
      build: (cfg) =>
        createDelegateTool({
          dispatchSynthetic,
          config: cfg,
          logger: ctx.logger as never,
        }),
    },
    {
      capability: 'list_peers',
      build: (cfg) =>
        createListActivePeersTool({
          pauseStore,
          config: cfg,
          logger: ctx.logger as never,
        }),
    },
    {
      capability: 'peer_summary',
      build: (cfg) =>
        createPeerSummaryTool({
          searchAgentMemory,
          config: cfg,
          logger: ctx.logger as never,
        }),
    },
    {
      capability: 'escalate',
      build: (cfg) =>
        createEscalateTool({
          notificationsEmitter,
          enabled: cfg.enabled,
          logger: ctx.logger as never,
        }),
    },
  ];

  // Filter by GLOBAL capabilities first — agents can never opt INTO a tool
  // the gateway-wide config has excluded. Per-agent capabilities can only
  // narrow further at call time.
  const exposed = descriptors.filter((d) => globalCfg.capabilities.includes(d.capability));

  // When the plugin is fully off (enabled=false at the global level AND no
  // agent flips it on), avoid registering anything. We still register the
  // wrappers so individual agents can flip enabled=true via per-agent config.
  for (const desc of exposed) {
    const wrapped = wrapToolWithPerAgentGating(ctx, desc);
    ctx.registerMcpTool(wrapped);
  }

  ctx.logger.info(
    { count: exposed.length, capabilities: exposed.map((d) => d.capability) },
    'operator-console: registered tools',
  );

  return {
    shutdown: async () => {
      ctx.logger.info({}, 'operator-console plugin shutting down');
    },
    onAgentConfigChanged(agentId: string) {
      // No per-agent state cached — tools resolve config per-call.
      ctx.logger.debug({ agentId }, 'operator-console: per-agent config changed');
    },
  };
}

// ── Helpers ───────────────────────────────────────────────────────────

function readGlobalConfig(ctx: PluginContext): OperatorConsoleConfig {
  const raw = (ctx.getGlobalConfig() as
    | { plugins?: { 'operator-console'?: unknown } }
    | undefined)?.plugins?.['operator-console'];
  // Default global is "all capabilities exposed but disabled" — per-agent
  // configs flip enabled=true and refine further.
  return resolveConfig(raw ?? { enabled: true, manages: '*' });
}

function readPerAgentConfig(
  ctx: PluginContext,
  agentId: string,
): OperatorConsoleConfig {
  const raw = (ctx.getAgentConfig(agentId) as
    | { plugins?: { 'operator-console'?: unknown } }
    | undefined)?.plugins?.['operator-console'];
  return resolveConfig(raw ?? {});
}

function wrapToolWithPerAgentGating(
  ctx: PluginContext,
  desc: ToolDescriptor,
): PluginMcpTool {
  const proto = desc.build(resolveConfig({ enabled: true, manages: '*' }), '');

  const handler = async (
    raw: unknown,
    toolCtx: McpToolContext,
  ): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
    const cfg = readPerAgentConfig(ctx, toolCtx.agentId);
    if (!cfg.enabled) {
      return errorResult(
        'operator-console plugin is not enabled for this agent (set plugins["operator-console"].enabled=true in agent.yml)',
      );
    }
    if (!cfg.capabilities.includes(desc.capability)) {
      return errorResult(
        `capability "${desc.capability}" is not enabled for this agent (add it to plugins["operator-console"].capabilities)`,
      );
    }
    // Rebuild the underlying tool with the agent's actual config so
    // permission checks (canManage) see the right manages list.
    const real = desc.build(cfg, toolCtx.agentId);
    return real.handler(raw, toolCtx);
  };

  return {
    name: proto.name,
    description: proto.description,
    inputSchema: proto.inputSchema,
    handler,
  };
}

function errorResult(message: string): {
  content: Array<{ type: 'text'; text: string }>;
} {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
  };
}
