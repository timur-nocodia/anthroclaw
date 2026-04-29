import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { getGateway } from '@/lib/gateway';
import { setAgentPluginEnabled, ValidationError } from '@/lib/agents';

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string; name: string }> },
) {
  return withAuth(async () => {
    const { agentId, name } = await params;

    const body = (await req.json().catch(() => null)) as { enabled?: unknown } | null;
    if (!body || typeof body.enabled !== 'boolean') {
      throw new ValidationError('invalid_body', 'Body must be { enabled: boolean }');
    }
    const enabled = body.enabled;

    const gw = await getGateway();
    const known = gw.pluginRegistry.listPlugins().some((p) => p.manifest.name === name);
    if (!known) {
      throw new ValidationError('unknown_plugin', `Plugin not installed: ${name}`);
    }

    // Persist to agent.yml (throws NotFoundError → 404 if agent missing).
    setAgentPluginEnabled(agentId, name, enabled);

    // Eagerly toggle live registry so the UI reflects state without waiting
    // on the hot-reload watcher.
    if (enabled) {
      gw.pluginRegistry.enableForAgent(agentId, name);
    } else {
      gw.pluginRegistry.disableForAgent(agentId, name);
    }

    // Refresh the agent's MCP server immediately — otherwise the running
    // agent keeps the old tool set until the watcher debounce expires.
    gw.refreshAgentPluginTools(agentId);
    // Toggling enable also changes per-agent runtime state for plugins that
    // cache it (e.g. LCM tears down its DB handle when disabled). Notify so
    // those caches invalidate before the next dispatch.
    await gw.notifyAgentConfigChanged(agentId);

    return NextResponse.json({ ok: true, enabled });
  });
}
