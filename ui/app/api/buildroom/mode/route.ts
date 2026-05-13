import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { setBuildroomMode } from '@/lib/buildroom';
import { ValidationError } from '@/lib/agents';

const MODES = new Set(['off', 'observe_only', 'manual_approval']);

export async function POST(req: NextRequest) {
  return withAuth(async () => {
    const body = await req.json().catch(() => ({})) as { mode?: unknown };
    if (typeof body.mode !== 'string' || !MODES.has(body.mode)) {
      throw new ValidationError('invalid_mode', '"mode" must be off, observe_only, or manual_approval');
    }

    const result = await setBuildroomMode(body.mode);
    return NextResponse.json(result.body, { status: result.status });
  });
}
