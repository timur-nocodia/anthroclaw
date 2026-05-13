import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { setBuildroomKillSwitch } from '@/lib/buildroom';
import { ValidationError } from '@/lib/agents';

export async function POST(req: NextRequest) {
  return withAuth(async () => {
    const body = await req.json().catch(() => ({})) as { active?: unknown };
    if (typeof body.active !== 'boolean') {
      throw new ValidationError('invalid_kill_switch', '"active" boolean is required');
    }

    const result = await setBuildroomKillSwitch(body.active);
    return NextResponse.json(result.body, { status: result.status });
  });
}
