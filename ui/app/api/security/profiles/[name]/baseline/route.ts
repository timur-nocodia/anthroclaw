import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { CHAT_PERSONALITY_BASELINE } from '@backend/security/profiles/chat-personality-baseline.js';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  return withAuth(async () => {
    const { name } = await params;
    if (name !== 'chat_like_openclaw') {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    return NextResponse.json({ baseline: CHAT_PERSONALITY_BASELINE });
  });
}
