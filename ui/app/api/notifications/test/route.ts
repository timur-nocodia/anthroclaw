/**
 * POST /api/notifications/test — dispatch a synthetic notification through
 * the agent's configured route(s) so operators can verify their setup.
 *
 * Body shape:
 *   {
 *     agentId: string,
 *     event?: NotificationEventName,    // default 'escalation_needed'
 *     route?: string,                   // optional: limit to a specific route name
 *     message?: string,                 // free-form text
 *   }
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { getGateway } from '@/lib/gateway';

interface PostBody {
  agentId?: unknown;
  event?: unknown;
  route?: unknown;
  message?: unknown;
}

const KNOWN_EVENTS = new Set([
  'peer_pause_started',
  'peer_pause_ended',
  'peer_pause_intervened_during_generation',
  'peer_pause_summary_daily',
  'agent_error',
  'iteration_budget_exhausted',
  'escalation_needed',
]);

export async function POST(req: NextRequest) {
  return withAuth(async () => {
    const body = (await req.json()) as PostBody;
    const agentId = typeof body.agentId === 'string' ? body.agentId : null;
    if (!agentId) {
      return NextResponse.json(
        { error: 'invalid_body', message: 'agentId is required' },
        { status: 400 },
      );
    }
    const event = typeof body.event === 'string' && KNOWN_EVENTS.has(body.event)
      ? body.event
      : 'escalation_needed';
    const message = typeof body.message === 'string' ? body.message : 'Test notification from operator UI';

    const gw = await getGateway();
    if (!gw.notificationsEmitter) {
      return NextResponse.json(
        { error: 'notifications_unavailable' },
        { status: 503 },
      );
    }

    await gw.notificationsEmitter.emit(event as 'escalation_needed', {
      agentId,
      message,
      priority: 'medium',
      test: true,
      source: 'ui:notifications-test',
      at: new Date().toISOString(),
    });

    return NextResponse.json({ ok: true, agentId, event });
  });
}
