import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { getAgentConfig, NotFoundError } from '@/lib/agents';
import { parse as parseYaml } from 'yaml';
import { validateSafetyProfile } from '@backend/security/profiles/validate.js';
import type { AgentYml } from '@backend/config/schema.js';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  return withAuth(async () => {
    const { agentId } = await params;

    let rawConfig: Record<string, unknown>;
    try {
      const { raw } = getAgentConfig(agentId);
      rawConfig = (parseYaml(raw) ?? {}) as Record<string, unknown>;
    } catch (err) {
      if (err instanceof NotFoundError) {
        // Agent not yet persisted — validate the submitted payload standalone
        rawConfig = {};
      } else {
        throw err;
      }
    }

    const body = (await req.json()) as {
      safety_profile?: string;
      safety_overrides?: Record<string, unknown>;
    };

    // Merge submitted overrides into the current config snapshot
    const merged: Record<string, unknown> = {
      ...rawConfig,
      ...(body.safety_profile !== undefined ? { safety_profile: body.safety_profile } : {}),
      ...(body.safety_overrides !== undefined ? { safety_overrides: body.safety_overrides } : {}),
    };

    // validateSafetyProfile expects a full AgentYml; cast is safe because it
    // only reads safety_profile, safety_overrides, allowlist, and mcp_tools.
    const result = validateSafetyProfile(merged as unknown as AgentYml);

    return NextResponse.json({
      ok: result.ok,
      error: result.error,
      warnings: result.warnings,
    });
  });
}
