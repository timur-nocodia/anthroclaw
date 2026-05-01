/**
 * GET /api/agents/[agentId]/config-audit — recent self-config audit entries.
 *
 * Reads from the gateway's `ConfigAuditLog` (per-agent JSONL file at
 * `data/config-audit/<agentId>.jsonl`). Returns entries newest-first.
 *
 * Query params:
 *   - section: 'notifications' | 'human_takeover' | 'operator_console'
 *              (filter; absent = all sections)
 *   - limit:   integer 1..200 (default 50)
 *
 * Response: `{ entries: PersistedAuditEntry[] }` — empty when the agent has
 * no audit history or the gateway has no audit log configured.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { getGateway } from '@/lib/gateway';
import type { ConfigSection } from '@backend/config/writer.js';

const VALID_SECTIONS: ReadonlySet<ConfigSection> = new Set([
  'notifications',
  'human_takeover',
  'operator_console',
]);

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function parseSection(raw: string | null): ConfigSection | undefined {
  if (!raw) return undefined;
  return VALID_SECTIONS.has(raw as ConfigSection) ? (raw as ConfigSection) : undefined;
}

function parseLimit(raw: string | null): number {
  if (!raw) return DEFAULT_LIMIT;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  return withAuth(async () => {
    const { agentId } = await params;
    const url = new URL(req.url);
    const section = parseSection(url.searchParams.get('section'));
    const limit = parseLimit(url.searchParams.get('limit'));

    const gw = await getGateway();
    const log = gw.getConfigAuditLog();
    if (!log) {
      return NextResponse.json({ entries: [] });
    }
    const entries = await log.readRecent(agentId, { limit, section });
    return NextResponse.json({ entries });
  });
}
