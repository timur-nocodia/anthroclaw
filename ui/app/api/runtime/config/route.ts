import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { getRuntimeProviders, updateRuntimeConfig } from '@/lib/runtime-setup';

export async function GET() {
  return withAuth(async () => {
    return NextResponse.json(await getRuntimeProviders());
  });
}

export async function PATCH(req: NextRequest) {
  return withAuth(async () => {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json(
        { error: 'invalid_body', message: 'Expected a JSON object.' },
        { status: 400 },
      );
    }

    const patch = body as {
      runtimeMode?: unknown;
      defaultModel?: unknown;
      piAuthPath?: unknown;
      piModelsPath?: unknown;
    };

    await updateRuntimeConfig({
      runtimeMode: typeof patch.runtimeMode === 'string'
        && ['pi', 'claude-agent-sdk', 'opencode'].includes(patch.runtimeMode)
        ? patch.runtimeMode as 'pi' | 'claude-agent-sdk' | 'opencode'
        : undefined,
      defaultModel: typeof patch.defaultModel === 'string' && patch.defaultModel.trim()
        ? patch.defaultModel.trim()
        : undefined,
      piAuthPath: typeof patch.piAuthPath === 'string'
        ? patch.piAuthPath.trim() || null
        : patch.piAuthPath === null ? null : undefined,
      piModelsPath: typeof patch.piModelsPath === 'string'
        ? patch.piModelsPath.trim() || null
        : patch.piModelsPath === null ? null : undefined,
    });

    return NextResponse.json({ ok: true });
  });
}
