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
    const entries = gw.pluginRegistry.listPlugins();

    const plugins: AgentPluginEntry[] = entries.map((entry) => {
      const name = entry.manifest.name;
      return {
        name,
        enabled: gw.pluginRegistry.isEnabledFor(agentId, name),
        config: getAgentPluginConfig(agentId, name),
      };
    });

    const response: AgentPluginsResponse = { agentId, plugins };
    return NextResponse.json(response);
  });
}
