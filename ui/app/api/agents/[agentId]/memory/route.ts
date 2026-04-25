import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { getGateway } from '@/lib/gateway';

const REVIEW_STATUSES = new Set(['pending', 'approved', 'rejected']);

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  return withAuth(async () => {
    const { agentId } = await params;
    const url = new URL(req.url);
    const limit = optionalNumber(url.searchParams.get('limit')) ?? 100;
    const offset = optionalNumber(url.searchParams.get('offset')) ?? 0;
    const gw = await getGateway();

    const entries = gw.listAgentMemoryEntries(agentId, {
      path: url.searchParams.get('path') ?? undefined,
      source: url.searchParams.get('source') ?? undefined,
      reviewStatus: parseReviewStatus(url.searchParams.get('reviewStatus')),
      limit,
      offset,
    });

    return NextResponse.json({ entries });
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ agentId: string }> },
) {
  return withAuth(async () => {
    const { agentId } = await params;
    const body = await req.json().catch(() => ({})) as {
      entryId?: unknown;
      reviewStatus?: unknown;
      reviewNote?: unknown;
    };

    const entryId = typeof body.entryId === 'string' ? body.entryId : '';
    const reviewStatus = typeof body.reviewStatus === 'string'
      ? parseReviewStatus(body.reviewStatus)
      : undefined;
    const reviewNote = typeof body.reviewNote === 'string' ? body.reviewNote : undefined;

    if (!entryId || !reviewStatus) {
      return NextResponse.json(
        { error: 'bad_request', message: 'Expected { entryId, reviewStatus }' },
        { status: 400 },
      );
    }

    const gw = await getGateway();
    const result = gw.updateAgentMemoryEntryReview(agentId, entryId, reviewStatus, reviewNote);
    return NextResponse.json(result, { status: result.updated ? 200 : 404 });
  });
}

function optionalNumber(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseReviewStatus(value: string | null): 'pending' | 'approved' | 'rejected' | undefined {
  if (value && REVIEW_STATUSES.has(value)) {
    return value as 'pending' | 'approved' | 'rejected';
  }
  return undefined;
}
