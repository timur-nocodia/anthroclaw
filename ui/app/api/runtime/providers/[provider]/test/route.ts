import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { testPiProvider } from '@/lib/runtime-setup';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  return withAuth(async () => {
    const { provider } = await params;
    const body = await req.json().catch(() => null) as { model?: unknown } | null;
    const model = typeof body?.model === 'string' ? body.model : undefined;
    return NextResponse.json(await testPiProvider(provider, model));
  });
}
