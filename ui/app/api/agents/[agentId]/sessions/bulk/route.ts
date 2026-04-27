import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { getGateway } from '@/lib/gateway';

interface BulkBody {
  action?: string;
  sessionIds?: unknown;
  labels?: unknown;
}

const LABEL_ACTIONS = new Set(['addLabels', 'removeLabels']);
const ALL_ACTIONS = new Set(['delete', ...LABEL_ACTIONS]);

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  return withAuth(async () => {
    const { agentId } = await params;
    const body = (await req.json().catch(() => ({}))) as BulkBody;

    if (typeof body.action !== 'string' || !ALL_ACTIONS.has(body.action)) {
      return NextResponse.json(
        { error: 'invalid_action', message: `Supported actions: ${[...ALL_ACTIONS].join(', ')}` },
        { status: 400 },
      );
    }

    const sessionIds = parseStringArray(body.sessionIds);
    if (sessionIds.length === 0) {
      return NextResponse.json(
        { error: 'invalid_request', message: 'sessionIds must be a non-empty array of strings' },
        { status: 400 },
      );
    }

    const gw = await getGateway();

    if (body.action === 'delete') {
      let deleted = 0;
      const errors: Array<{ sessionId: string; message: string }> = [];
      for (const sessionId of sessionIds) {
        try {
          await gw.deleteAgentSession(agentId, sessionId);
          deleted++;
        } catch (err) {
          errors.push({ sessionId, message: (err as Error).message });
        }
      }
      return NextResponse.json({ deleted, errors });
    }

    const labels = parseStringArray(body.labels).map((l) => l.trim()).filter(Boolean);
    if (labels.length === 0) {
      return NextResponse.json(
        { error: 'invalid_request', message: 'labels must be a non-empty array of strings' },
        { status: 400 },
      );
    }

    let updated = 0;
    const errors: Array<{ sessionId: string; message: string }> = [];
    for (const sessionId of sessionIds) {
      try {
        const current = await gw.getAgentSessionLabels(agentId, sessionId);
        const next = body.action === 'addLabels'
          ? [...new Set([...current, ...labels])]
          : current.filter((l) => !labels.includes(l));
        await gw.setAgentSessionLabels(agentId, sessionId, next);
        updated++;
      } catch (err) {
        errors.push({ sessionId, message: (err as Error).message });
      }
    }
    return NextResponse.json({ updated, errors });
  });
}
