import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { installSkillFromGit } from '@/lib/skills';
import { ValidationError } from '@/lib/agents';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  return withAuth(async () => {
    const { agentId } = await params;
    const body = await req.json();
    const { url, ref, branch, name: skillName } = body as {
      url: string;
      ref?: string;
      branch?: string;
      name?: string;
    };

    if (!url) {
      throw new ValidationError('invalid_request', '"url" is required');
    }

    const name = installSkillFromGit(agentId, url, ref ?? branch, skillName);
    return NextResponse.json({ name, ok: true });
  });
}
