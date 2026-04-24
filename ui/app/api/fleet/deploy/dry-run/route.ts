import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { deployDryRun } from '@/lib/deploy';
import type { DeployConfig } from '@/lib/deploy';

export async function POST(req: NextRequest) {
  return withAuth(async () => {
    let config: DeployConfig;
    try {
      config = (await req.json()) as DeployConfig;
    } catch {
      return NextResponse.json(
        { error: 'validation_error', message: 'Invalid JSON body' },
        { status: 400 },
      );
    }

    if (!config.identity?.name || !config.target?.host) {
      return NextResponse.json(
        {
          error: 'validation_error',
          message: 'Required: identity.name, target.host',
        },
        { status: 400 },
      );
    }

    const result = await deployDryRun(config);
    return NextResponse.json(result);
  });
}
