/**
 * GET /api/agents/[agentId]/lcm/status?session=...
 *
 * Plan 3 Task C1 — JSON snapshot of an agent's LCM context pressure.
 *
 * Reads the per-agent LCM SQLite DB read-only (no live gateway needed) and
 * computes a structured equivalent of what the lcm_status MCP tool returns,
 * plus a pressure indicator (green/yellow/orange/red) derived from the
 * agent's `plugins.lcm.triggers.compress_threshold_tokens` (default 40000).
 *
 * Returns 200 with all-zeros (pressure: green) when the LCM DB doesn't exist.
 * Returns 404 when the agent doesn't exist.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { getAgentConfig, getAgentPluginConfig } from '@/lib/agents';
import { openLcmReadOnly } from '@/lib/lcm';

const DEFAULT_THRESHOLD = 40_000;
const RATIO_CAP = 1.5;

type Pressure = 'green' | 'yellow' | 'orange' | 'red';

type LcmStatus = {
  agentId: string;
  session: string | null;
  totalSessions: number;
  totalMessages: number;
  totalTokens: number;
  countsByDepth: Record<number, number>;
  contextPressure: Pressure;
  threshold: number;
  pressureRatio: number;
  earliestTs: number | null;
  latestTs: number | null;
};

function bucketPressure(ratio: number): Pressure {
  if (ratio >= 0.95) return 'red';
  if (ratio >= 0.8) return 'orange';
  if (ratio >= 0.5) return 'yellow';
  return 'green';
}

function readThreshold(agentId: string): number {
  // getAgentPluginConfig may return arbitrary shape — defensive walk down.
  const block = getAgentPluginConfig(agentId, 'lcm');
  const triggers = (block as { triggers?: unknown }).triggers;
  if (!triggers || typeof triggers !== 'object') return DEFAULT_THRESHOLD;
  const raw = (triggers as { compress_threshold_tokens?: unknown }).compress_threshold_tokens;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return DEFAULT_THRESHOLD;
  return Math.floor(raw);
}

function emptyStatus(agentId: string, session: string | null, threshold: number): LcmStatus {
  return {
    agentId,
    session,
    totalSessions: 0,
    totalMessages: 0,
    totalTokens: 0,
    countsByDepth: {},
    contextPressure: 'green',
    threshold,
    pressureRatio: 0,
    earliestTs: null,
    latestTs: null,
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  return withAuth(async () => {
    const { agentId } = await params;
    // Throws NotFoundError → 404 if the agent doesn't exist.
    getAgentConfig(agentId);

    const url = new URL(req.url);
    const session = url.searchParams.get('session');
    const threshold = readThreshold(agentId);

    const handle = openLcmReadOnly(agentId);
    if (!handle) {
      return NextResponse.json(emptyStatus(agentId, session, threshold));
    }

    try {
      let totalSessions: number;
      let totalMessages: number;
      let totalTokens: number;
      let countsByDepth: Record<number, number>;
      let earliestTs: number | null;
      let latestTs: number | null;

      try {
        totalSessions = handle.dag.listSessionIds().length;
        if (session) {
          totalMessages = handle.store.countInSession(session);
          totalTokens = handle.store.totalTokensInSession(session);
          countsByDepth = handle.dag.countByDepth(session);
        } else {
          totalMessages = handle.store.totalMessages();
          totalTokens = handle.store.totalTokensAcrossSessions();
          countsByDepth = handle.dag.countByDepthAcrossSessions();
        }
        const range = handle.store.timeRange();
        earliestTs = range.oldest;
        latestTs = range.newest;
      } catch {
        // Schema looks valid enough to construct, but a query failed. Surface
        // as empty state rather than 500 — matches the dag route's posture.
        return NextResponse.json(emptyStatus(agentId, session, threshold));
      }

      const rawRatio = threshold > 0 ? totalTokens / threshold : 0;
      const pressureRatio = Math.min(rawRatio, RATIO_CAP);
      const contextPressure = bucketPressure(rawRatio);

      const response: LcmStatus = {
        agentId,
        session,
        totalSessions,
        totalMessages,
        totalTokens,
        countsByDepth,
        contextPressure,
        threshold,
        pressureRatio,
        earliestTs,
        latestTs,
      };

      return NextResponse.json(response);
    } finally {
      handle.db.close();
    }
  });
}
