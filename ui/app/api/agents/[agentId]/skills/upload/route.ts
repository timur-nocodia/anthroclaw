import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { installSkillFromArchive } from '@/lib/skills';
import { ValidationError } from '@/lib/agents';

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  return withAuth(async () => {
    const { agentId } = await params;
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const overwrite = formData.get('overwrite') === 'true';

    if (!file) {
      throw new ValidationError('invalid_request', 'No file provided');
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'file_too_large' }, { status: 413 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const name = await installSkillFromArchive(agentId, buffer, file.name, overwrite);

    return NextResponse.json({ name, ok: true });
  });
}
