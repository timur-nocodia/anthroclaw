import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import {
  deletePiProviderCredential,
  savePiProviderApiKey,
} from '@/lib/runtime-setup';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  return withAuth(async () => {
    const { provider } = await params;
    const body = await req.json().catch(() => null) as { apiKey?: unknown } | null;
    if (!body || typeof body.apiKey !== 'string' || body.apiKey.trim() === '') {
      return NextResponse.json(
        { error: 'invalid_api_key', message: 'apiKey is required.' },
        { status: 400 },
      );
    }

    await savePiProviderApiKey(provider, body.apiKey);
    return NextResponse.json({ ok: true });
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  return withAuth(async () => {
    const { provider } = await params;
    await deletePiProviderCredential(provider);
    return NextResponse.json({ ok: true });
  });
}
