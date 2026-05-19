import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { runRuntimeTestTurn } from '@/lib/runtime-setup';

export async function POST(req: NextRequest) {
  return withAuth(async () => {
    const body = await req.json().catch(() => null) as {
      model?: unknown;
      prompt?: unknown;
      timeoutMs?: unknown;
    } | null;

    const timeoutMs = typeof body?.timeoutMs === 'number'
      && Number.isInteger(body.timeoutMs)
      && body.timeoutMs > 0
      ? body.timeoutMs
      : undefined;

    return NextResponse.json(await runRuntimeTestTurn({
      model: typeof body?.model === 'string' && body.model.trim() ? body.model.trim() : undefined,
      prompt: typeof body?.prompt === 'string' && body.prompt.trim() ? body.prompt.trim() : undefined,
      timeoutMs,
    }));
  });
}
