import { NextRequest, NextResponse } from 'next/server';
import { resolve, relative, join } from 'node:path';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { withAuth } from '@/lib/route-handler';
import { NotFoundError, ValidationError } from '@/lib/agents';

const REPO_ROOT = process.cwd().endsWith('/ui')
  ? resolve(process.cwd(), '..')
  : process.cwd();
const AGENTS_DIR = process.env.OC_AGENTS_DIR
  ? resolve(process.env.OC_AGENTS_DIR)
  : resolve(REPO_ROOT, 'agents');

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  return withAuth(async () => {
    const { agentId } = await params;

    if (!/^[a-z0-9][a-z0-9_-]*$/.test(agentId) || agentId.length > 64) {
      throw new ValidationError('invalid_agent_id', 'Invalid agent id');
    }

    const path = req.nextUrl.searchParams.get('path');
    if (!path || typeof path !== 'string') {
      throw new ValidationError('invalid_path', 'Query param "path" is required');
    }

    const agentDir = join(AGENTS_DIR, agentId);
    if (!existsSync(join(agentDir, 'agent.yml'))) {
      throw new NotFoundError(agentId);
    }

    const resolved = resolve(agentDir, path);
    const rel = relative(agentDir, resolved);
    if (rel.startsWith('..')) {
      throw new ValidationError('invalid_path', 'Path traverses outside the agent directory');
    }

    if (!existsSync(resolved)) {
      if (req.nextUrl.searchParams.get('optional') === 'true') {
        return NextResponse.json({ path, content: '', updatedAt: null });
      }
      throw new NotFoundError(`${agentId}/${path}`);
    }

    const stat = statSync(resolved);
    if (!stat.isFile()) {
      throw new ValidationError('not_a_file', 'Path is not a regular file');
    }

    const content = readFileSync(resolved, 'utf-8');
    return NextResponse.json({ path, content, updatedAt: stat.mtime.toISOString() });
  });
}
