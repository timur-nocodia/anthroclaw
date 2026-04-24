import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { getSkill, deleteSkill } from '@/lib/skills';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ agentId: string; skillName: string }> },
) {
  return withAuth(async () => {
    const { agentId, skillName } = await params;
    return NextResponse.json(getSkill(agentId, decodeURIComponent(skillName)));
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ agentId: string; skillName: string }> },
) {
  return withAuth(async () => {
    const { agentId, skillName } = await params;
    deleteSkill(agentId, decodeURIComponent(skillName));
    return NextResponse.json({ ok: true });
  });
}
