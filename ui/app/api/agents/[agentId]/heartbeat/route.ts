import { resolve } from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { getAgentConfig, setAgentHeartbeatConfig, ValidationError } from '@/lib/agents';
import { HeartbeatHistoryStore } from '@backend/heartbeat/history.js';

const DATA_DIR = resolve(process.cwd(), '..', 'data');

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  return withAuth(async () => {
    const { agentId } = await params;
    const limit = Number.parseInt(req.nextUrl.searchParams.get('limit') ?? '50', 10);
    const { parsed } = getAgentConfig(agentId);
    const history = new HeartbeatHistoryStore(
      resolve(DATA_DIR, 'heartbeat-output'),
      resolve(DATA_DIR, 'heartbeat-runs.jsonl'),
    );
    const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 50;
    const runs = history
      .listRuns(Math.max(safeLimit * 10, safeLimit))
      .filter((run) => run.agentId === agentId)
      .slice(-safeLimit);
    return NextResponse.json({
      agentId,
      heartbeat: parsed.heartbeat ?? null,
      runs,
    });
  });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  return withAuth(async () => {
    const { agentId } = await params;
    const body = await req.json();
    const heartbeat = body?.heartbeat;
    if (!heartbeat || typeof heartbeat !== 'object' || Array.isArray(heartbeat)) {
      throw new ValidationError('invalid_request', '"heartbeat" object is required');
    }
    setAgentHeartbeatConfig(agentId, heartbeat as Record<string, unknown>);
    return NextResponse.json({ ok: true, heartbeat });
  });
}
