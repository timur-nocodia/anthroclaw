import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/route-handler';
import { getGateway } from '@/lib/gateway';
import { getPluginDir, loadPluginConfigSchema, resolveConfigSchemaPath } from '@/lib/plugin-schema';

export interface PluginConfigSchemaResponse {
  name: string;
  jsonSchema: unknown;
  defaults: unknown;
}

/**
 * Returns the plugin's Zod config schema serialized as JSON Schema, plus the
 * defaults produced by `schema.parse({})`. The UI uses this to build a config
 * form and to know what the "blank" config block looks like.
 *
 * 404 when:
 *  - the plugin is not installed, or
 *  - the manifest doesn't declare a `configSchema`, or
 *  - the schema module exists but exports no Zod schema we recognise.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  return withAuth(async () => {
    const { name } = await params;

    const gw = await getGateway();
    const entry = gw.pluginRegistry.listPlugins().find((p) => p.manifest.name === name);
    if (!entry) {
      return NextResponse.json({ error: 'unknown_plugin' }, { status: 404 });
    }

    const configSchemaRel = entry.manifest.configSchema;
    if (!configSchemaRel || typeof configSchemaRel !== 'string') {
      return NextResponse.json({ error: 'no_config_schema' }, { status: 404 });
    }

    // The gateway loads plugins from `<dataDir>/../plugins` by default. We
    // mirror that convention from the UI cwd, which is `<repoRoot>/ui`.
    const pluginsDirOverride =
      typeof (gw as unknown as { getResolvedPluginsDir?: () => string }).getResolvedPluginsDir === 'function'
        ? (gw as unknown as { getResolvedPluginsDir: () => string }).getResolvedPluginsDir()
        : undefined;
    const pluginDir = getPluginDir(name, pluginsDirOverride);
    const schemaPath = resolveConfigSchemaPath(pluginDir, configSchemaRel);

    const schema = await loadPluginConfigSchema(name, schemaPath);
    if (!schema) {
      return NextResponse.json({ error: 'no_config_schema' }, { status: 404 });
    }

    // Zod 4 ships toJSONSchema natively — no third-party converter required.
    const jsonSchema = z.toJSONSchema(schema);

    let defaults: unknown;
    try {
      defaults = schema.parse({});
    } catch {
      // Schema doesn't fully default — return null so the UI can decide.
      defaults = null;
    }

    const response: PluginConfigSchemaResponse = { name, jsonSchema, defaults };
    return NextResponse.json(response);
  });
}
