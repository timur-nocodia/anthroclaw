import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { getGateway } from '@/lib/gateway';
import { getAgentConfig, getAgentPluginConfig } from '@/lib/agents';

export interface AgentPluginEntry {
  name: string;
  enabled: boolean;
  config: unknown;
}

export interface AgentPluginsResponse {
  agentId: string;
  plugins: AgentPluginEntry[];
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  return withAuth(async () => {
    const { agentId } = await params;
    // Throws NotFoundError → 404 if the agent dir/agent.yml is missing.
    getAgentConfig(agentId);

    const gw = await getGateway();
    const entries = getKnownPluginNames(gw);

    const plugins: AgentPluginEntry[] = entries.map((name) => {
      const config = getAgentPluginConfig(agentId, name);
      return {
        name,
        enabled: isEnabledConfig(config) || gw.pluginRegistry.isEnabledFor(agentId, name),
        config,
      };
    });

    const response: AgentPluginsResponse = { agentId, plugins };
    return NextResponse.json(response);
  });
}

function getKnownPluginNames(gw: Awaited<ReturnType<typeof getGateway>>): string[] {
  const catalog = (gw as unknown as { pluginCatalog?: { entries?: Array<{ name: string }> } }).pluginCatalog;
  if (Array.isArray(catalog?.entries) && catalog.entries.length > 0) {
    return catalog.entries.map((entry) => entry.name);
  }
  return gw.pluginRegistry.listPlugins().map((entry) => entry.manifest.name);
}

function isEnabledConfig(config: unknown): boolean {
  return Boolean(
    config &&
    typeof config === 'object' &&
    !Array.isArray(config) &&
    (config as { enabled?: unknown }).enabled === true,
  );
}
