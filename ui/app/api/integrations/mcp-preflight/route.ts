import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { getGateway } from '@/lib/gateway';

export async function GET() {
  return withAuth(async () => {
    const gw = await getGateway();
    return NextResponse.json({
      generatedAt: Date.now(),
      servers: gw.listMcpServerPreflight(),
    });
  });
}

export async function POST(req: NextRequest) {
  return withAuth(async () => {
    const body = await req.json().catch(() => ({}));
    const spec = isRecord(body.spec) ? body.spec : undefined;
    if (!spec) {
      return NextResponse.json(
        { error: 'bad_request', message: 'Expected { spec } with an MCP server spec object.' },
        { status: 400 },
      );
    }

    const toolNamesByServer = isToolMap(body.toolNamesByServer) ? body.toolNamesByServer : undefined;
    const source = body.source === 'agent_local' || body.source === 'subagent_portable'
      ? body.source
      : 'external';
    const gw = await getGateway();
    return NextResponse.json({
      generatedAt: Date.now(),
      servers: gw.preflightMcpServerSpec(spec as never, {
        ownerAgentId: typeof body.ownerAgentId === 'string' ? body.ownerAgentId : undefined,
        source,
        toolNamesByServer,
      }),
    });
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isToolMap(value: unknown): value is Record<string, string[]> {
  return Boolean(
    value
      && typeof value === 'object'
      && !Array.isArray(value)
      && Object.values(value).every((entry) => (
        Array.isArray(entry) && entry.every((toolName) => typeof toolName === 'string')
      )),
  );
}
