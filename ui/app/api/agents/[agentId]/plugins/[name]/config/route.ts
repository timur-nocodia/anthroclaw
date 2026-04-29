import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { getGateway } from '@/lib/gateway';
import {
  getAgentConfig,
  getAgentPluginConfig,
  setAgentPluginConfig,
  ValidationError,
} from '@/lib/agents';
import { getPluginDir, loadPluginConfigSchema, resolveConfigSchemaPath } from '@/lib/plugin-schema';

export interface AgentPluginConfigResponse {
  agentId: string;
  pluginName: string;
  config: unknown;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ agentId: string; name: string }> },
) {
  return withAuth(async () => {
    const { agentId, name } = await params;
    // Throws NotFoundError → 404 if the agent dir/agent.yml is missing.
    getAgentConfig(agentId);

    const config = getAgentPluginConfig(agentId, name);

    const response: AgentPluginConfigResponse = {
      agentId,
      pluginName: name,
      config,
    };
    return NextResponse.json(response);
  });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string; name: string }> },
) {
  return withAuth(async () => {
    const { agentId, name } = await params;

    const body = (await req.json().catch(() => null)) as { config?: unknown } | null;
    if (
      !body ||
      typeof body.config !== 'object' ||
      body.config === null ||
      Array.isArray(body.config)
    ) {
      throw new ValidationError(
        'invalid_body',
        'Body must be { config: object }',
      );
    }
    const config = body.config as Record<string, unknown>;

    const gw = await getGateway();
    const entry = gw.pluginRegistry.listPlugins().find((p) => p.manifest.name === name);
    if (!entry) {
      throw new ValidationError('unknown_plugin', `Plugin not installed: ${name}`);
    }

    // Validate against the plugin's Zod schema before writing — operators
    // shouldn't be able to push invalid configs through the UI.
    const configSchemaRel = entry.manifest.configSchema;
    if (configSchemaRel && typeof configSchemaRel === 'string') {
      const pluginsDirOverride =
        typeof (gw as unknown as { getResolvedPluginsDir?: () => string }).getResolvedPluginsDir === 'function'
          ? (gw as unknown as { getResolvedPluginsDir: () => string }).getResolvedPluginsDir()
          : undefined;
      const pluginDir = getPluginDir(name, pluginsDirOverride);
      const schemaPath = resolveConfigSchemaPath(pluginDir, configSchemaRel);
      const schema = await loadPluginConfigSchema(name, schemaPath);
      if (schema) {
        const result = schema.safeParse(config);
        if (!result.success) {
          return NextResponse.json(
            { error: 'invalid_config', issues: result.error.issues },
            { status: 400 },
          );
        }
      }
    }

    // Persist to agent.yml (throws NotFoundError → 404 if agent missing).
    setAgentPluginConfig(agentId, name, config);

    // Mirror A1's eager refresh — the running agent picks up the new config
    // on its next dispatch without waiting on the watcher debounce.
    gw.refreshAgentPluginTools(agentId);
    // Plugins that cache per-agent state (e.g. LCM holds an LCMEngine + DB
    // handle keyed by agentId) need an explicit invalidation hook —
    // refreshAgentPluginTools only rebuilds the MCP tool list, not the
    // plugin instance's internal Maps.
    await gw.notifyAgentConfigChanged(agentId);

    return NextResponse.json({ ok: true });
  });
}
