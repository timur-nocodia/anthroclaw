import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { resolve, join } from 'node:path';
import { existsSync, rmSync } from 'node:fs';
import { NotFoundError } from '@/lib/agents';

const DATA_DIR = resolve(process.cwd(), '..', 'data');

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ accountId: string }> },
) {
  return withAuth(async () => {
    const { accountId } = await params;
    const authDir = join(DATA_DIR, 'whatsapp', accountId);

    if (!existsSync(authDir)) {
      throw new NotFoundError(accountId);
    }

    rmSync(authDir, { recursive: true, force: true });
    return NextResponse.json({ ok: true });
  });
}
