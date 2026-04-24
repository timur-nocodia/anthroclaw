import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { attachSkill, detachSkill, listSkills } from '@/lib/skills';
import { ValidationError } from '@/lib/agents';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  return withAuth(async () => {
    const { agentId } = await params;
    return NextResponse.json(listSkills(agentId));
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  return withAuth(async () => {
    const { agentId } = await params;
    const body = await req.json().catch(() => ({}));
    const action = body.action;
    const skillName = body.skillName;

    if (typeof skillName !== 'string') {
      throw new ValidationError('invalid_request', '"skillName" is required');
    }

    if (action === 'attach') {
      attachSkill(agentId, skillName);
      return NextResponse.json({ ok: true, attached: true });
    }

    if (action === 'detach') {
      detachSkill(agentId, skillName);
      return NextResponse.json({ ok: true, attached: false });
    }

    throw new ValidationError('invalid_request', 'Expected action "attach" or "detach"');
  });
}
