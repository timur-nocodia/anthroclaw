import { resolve } from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { getAgentConfig, setAgentHeartbeatConfig, ValidationError } from '@/lib/agents';
import { HeartbeatHistoryStore } from '@backend/heartbeat/history.js';
import { HeartbeatStateStore } from '@backend/heartbeat/state-store.js';
import { getGateway } from '@/lib/gateway';

const DATA_DIR = resolve(process.cwd(), '..', 'data');

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  return withAuth(async () => {
    const { agentId } = await params;
    const limit = Number.parseInt(req.nextUrl.searchParams.get('limit') ?? '50', 10);
    const outputPath = req.nextUrl.searchParams.get('outputPath');
    const { parsed } = getAgentConfig(agentId);
    const history = new HeartbeatHistoryStore(
      resolve(DATA_DIR, 'heartbeat-output'),
      resolve(DATA_DIR, 'heartbeat-runs.jsonl'),
    );
    if (outputPath) {
      return NextResponse.json({
        agentId,
        outputPath,
        content: history.readOutput(outputPath),
      });
    }

    const stateStore = new HeartbeatStateStore(resolve(DATA_DIR, 'heartbeat-state.json'));
    const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 50;
    const runs = history
      .listRuns(Math.max(safeLimit * 10, safeLimit))
      .filter((run) => run.agentId === agentId)
      .slice(-safeLimit);
    return NextResponse.json({
      agentId,
      heartbeat: parsed.heartbeat ?? null,
      state: stateStore.getAgent(agentId),
      runs,
    });
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  return withAuth(async () => {
    const { agentId } = await params;
    const body = await req.json().catch(() => ({}));
    if (body?.operation && body.operation !== 'run_now') {
      throw new ValidationError('invalid_request', 'Unsupported heartbeat operation');
    }
    const gw = await getGateway();
    const result = await gw.runHeartbeatNow(agentId);
    return NextResponse.json({ ok: result.status !== 'error', result });
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
