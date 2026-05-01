import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { getGateway } from '@/lib/gateway';
import { ValidationError } from '@/lib/agents';
import type { ConfigSection } from '@backend/config/writer.js';

const ALLOWED_SECTIONS = new Set<ConfigSection>([
  'notifications',
  'human_takeover',
  'operator_console',
]);

/**
 * Stage 1 self-config-tools: dedicated PATCH endpoint that routes a single
 * OCP-section update through the unified `AgentConfigWriter`. UI cards
 * (HumanTakeoverCard, NotificationsCard, …) post `{ section, value }` here
 * to get comment-preserving writes, automatic backups, schema validation,
 * and an audit-log entry tagged `source: 'ui'`.
 *
 * The legacy PUT `/api/agents/[id]` path stays for whole-config writes
 * (other fields like `model`, `routes`, `mcp_tools`).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  return withAuth(async () => {
    const { agentId } = await params;
    const body = (await req.json()) as { section?: string; value?: unknown };

    if (!body.section || !ALLOWED_SECTIONS.has(body.section as ConfigSection)) {
      throw new ValidationError(
        'invalid_section',
        `section must be one of: ${[...ALLOWED_SECTIONS].join(', ')}`,
      );
    }
    const section = body.section as ConfigSection;
    const value = body.value;

    const gw = await getGateway();
    const writer = gw.getAgentConfigWriter();
    if (!writer) {
      return NextResponse.json({ error: 'writer_unavailable' }, { status: 503 });
    }

    try {
      const result = await writer.patchSection(
        agentId,
        section,
        () => (value === null ? null : value),
        { caller: 'ui', source: 'ui', action: `ui_save_${section}` },
      );
      return NextResponse.json({
        ok: true,
        section: result.section,
        prev: result.prevValue ?? null,
        new: result.newValue,
        written_at: result.writtenAt,
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'ConfigValidationError') {
        return NextResponse.json(
          { error: 'invalid_yaml', message: err.message },
          { status: 400 },
        );
      }
      if (err instanceof Error && err.name === 'AgentConfigNotFoundError') {
        return NextResponse.json({ error: 'not_found' }, { status: 404 });
      }
      throw err;
    }
  });
}
