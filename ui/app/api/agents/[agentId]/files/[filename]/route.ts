import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { getAgentFile, writeAgentFile, deleteAgentFile, NotFoundError, ValidationError } from '@/lib/agents';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string; filename: string }> },
) {
  return withAuth(async () => {
    const { agentId, filename } = await params;
    const name = decodeURIComponent(filename);
    try {
      return NextResponse.json(getAgentFile(agentId, name));
    } catch (err) {
      if (err instanceof NotFoundError && req.nextUrl.searchParams.get('optional') === 'true') {
        return NextResponse.json({ name, content: '', updatedAt: null });
      }
      throw err;
    }
  });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string; filename: string }> },
) {
  return withAuth(async () => {
    const { agentId, filename } = await params;
    const body = await req.json();
    const { content } = body as { content: string };

    if (typeof content !== 'string') {
      throw new ValidationError('invalid_request', '"content" (string) is required');
    }

    writeAgentFile(agentId, decodeURIComponent(filename), content);
    return NextResponse.json({ ok: true });
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ agentId: string; filename: string }> },
) {
  return withAuth(async () => {
    const { agentId, filename } = await params;
    deleteAgentFile(agentId, decodeURIComponent(filename));
    return NextResponse.json({ ok: true });
  });
}
