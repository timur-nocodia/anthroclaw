import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { getGateway } from '@/lib/gateway';

export interface PluginListItem {
  name: string;
  version: string;
  description?: string;
  hasConfigSchema: boolean;
  hasMcpTools: boolean;
  hasContextEngine: boolean;
  toolCount: number;
}

export interface PluginListResponse {
  plugins: PluginListItem[];
}

export async function GET() {
  return withAuth(async () => {
    const gw = await getGateway();
    const entries = gw.pluginRegistry.listPlugins();

    const plugins: PluginListItem[] = entries.map((entry) => {
      const name = entry.manifest.name;
      const tools = gw.pluginRegistry.getMcpToolsForPlugin(name);
      return {
        name,
        version: entry.manifest.version,
        description: entry.manifest.description,
        hasConfigSchema: typeof entry.manifest.configSchema === 'string' && entry.manifest.configSchema.length > 0,
        hasMcpTools: tools.length > 0,
        hasContextEngine: gw.pluginRegistry.hasContextEngineForPlugin(name),
        toolCount: tools.length,
      };
    });

    const response: PluginListResponse = { plugins };
    return NextResponse.json(response);
  });
}
