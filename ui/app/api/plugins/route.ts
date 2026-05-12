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
  sourceType: string;
  sourceSpec?: string;
  installRoot: string;
  managed: boolean;
  loaded: boolean;
  dependencyState?: string;
  status: string;
}

export interface PluginListResponse {
  plugins: PluginListItem[];
}

export async function GET() {
  return withAuth(async () => {
    const gw = await getGateway();
    const runtimeEntries = gw.pluginRegistry.listPlugins();
    const runtimeByName = new Map(runtimeEntries.map((entry) => [entry.manifest.name, entry]));
    const catalogEntries = getCatalogEntries(gw, runtimeEntries);

    const plugins: PluginListItem[] = catalogEntries.map((catalogEntry) => {
      const name = catalogEntry.name;
      const runtimeEntry = runtimeByName.get(name);
      const manifest = catalogEntry.manifest ?? runtimeEntry?.manifest;
      const tools = gw.pluginRegistry.getMcpToolsForPlugin(name);
      return {
        name,
        version: catalogEntry.version ?? manifest?.version ?? 'unknown',
        description: manifest?.description,
        hasConfigSchema: typeof manifest?.configSchema === 'string' && manifest.configSchema.length > 0,
        hasMcpTools: Boolean(runtimeEntry) && tools.length > 0,
        hasContextEngine: Boolean(runtimeEntry) && gw.pluginRegistry.hasContextEngineForPlugin(name),
        toolCount: tools.length,
        sourceType: catalogEntry.sourceType,
        sourceSpec: catalogEntry.sourceSpec,
        installRoot: catalogEntry.pluginDir,
        managed: catalogEntry.sourceType === 'managed',
        loaded: Boolean(runtimeEntry) || catalogEntry.loaded,
        dependencyState: catalogEntry.dependencyState,
        status: catalogEntry.status,
      };
    });

    const response: PluginListResponse = { plugins };
    return NextResponse.json(response, {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    });
  });
}

type RuntimePluginEntry = ReturnType<Awaited<ReturnType<typeof getGateway>>['pluginRegistry']['listPlugins']>[number];

interface CatalogLikeEntry {
  name: string;
  version?: string;
  sourceType: string;
  sourceSpec?: string;
  pluginDir: string;
  manifest?: RuntimePluginEntry['manifest'];
  loaded: boolean;
  dependencyState?: string;
  status: string;
}

function getCatalogEntries(gw: Awaited<ReturnType<typeof getGateway>>, runtimeEntries: RuntimePluginEntry[]): CatalogLikeEntry[] {
  const catalog = (gw as unknown as { pluginCatalog?: { entries?: CatalogLikeEntry[] } }).pluginCatalog;
  if (Array.isArray(catalog?.entries) && catalog.entries.length > 0) {
    return catalog.entries;
  }
  const resolvedRoot =
    typeof (gw as unknown as { getResolvedPluginsDir?: () => string | null }).getResolvedPluginsDir === 'function'
      ? (gw as unknown as { getResolvedPluginsDir: () => string | null }).getResolvedPluginsDir()
      : null;
  return runtimeEntries.map((entry) => ({
    name: entry.manifest.name,
    version: entry.manifest.version,
    sourceType: 'bundled',
    pluginDir: resolvedRoot ? `${resolvedRoot}/${entry.manifest.name}` : entry.manifest.name,
    manifest: entry.manifest,
    loaded: true,
    status: 'ok',
  }));
}
