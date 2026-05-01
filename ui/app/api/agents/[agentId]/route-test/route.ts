/**
 * POST /api/agents/[agentId]/route-test — offline binding verification.
 *
 * Pure read-only inspection: reuses Gateway.routeTable.resolve() + access
 * checks (mention + pairing/allowlist) to tell the operator whether a given
 * synthetic peer payload would route to this agent, without dispatching.
 *
 * Body shape:
 *   {
 *     channel: 'telegram' | 'whatsapp',
 *     account_id: string,
 *     chat_type: 'dm' | 'group',
 *     peer_id: string,
 *     thread_id?: string,
 *     sender_id: string,
 *     text?: string,
 *     mentioned_bot?: boolean,
 *   }
 *
 * Response:
 *   {
 *     matched: boolean,
 *     agent_id: string | null,
 *     session_key: string | null,
 *     blockers: Array<{ stage: 'route'|'mention'|'access', reason: string }>,
 *   }
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { getGateway } from '@/lib/gateway';
import { buildSessionKey } from '@backend/routing/session-key.js';

interface RouteTestBody {
  channel?: unknown;
  account_id?: unknown;
  chat_type?: unknown;
  peer_id?: unknown;
  thread_id?: unknown;
  sender_id?: unknown;
  text?: unknown;
  mentioned_bot?: unknown;
}

interface Blocker {
  stage: 'route' | 'mention' | 'access';
  reason: string;
}

const VALID_CHANNELS = new Set(['telegram', 'whatsapp']);
const VALID_CHAT_TYPES = new Set(['dm', 'group']);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  return withAuth(async () => {
    const { agentId } = await params;
    let body: RouteTestBody;
    try {
      body = (await req.json()) as RouteTestBody;
    } catch {
      return NextResponse.json(
        { error: 'invalid_body', message: 'request body must be JSON' },
        { status: 400 },
      );
    }

    const channel = typeof body.channel === 'string' ? body.channel : null;
    const accountId = typeof body.account_id === 'string' ? body.account_id : null;
    const chatType = typeof body.chat_type === 'string' ? body.chat_type : null;
    const peerId = typeof body.peer_id === 'string' ? body.peer_id : null;
    const senderId = typeof body.sender_id === 'string' ? body.sender_id : null;
    const threadId = typeof body.thread_id === 'string' && body.thread_id.length > 0
      ? body.thread_id
      : undefined;
    const mentionedBot = body.mentioned_bot === true;

    if (!channel || !VALID_CHANNELS.has(channel)) {
      return NextResponse.json(
        { error: 'invalid_body', message: 'channel must be telegram or whatsapp' },
        { status: 400 },
      );
    }
    if (!accountId) {
      return NextResponse.json(
        { error: 'invalid_body', message: 'account_id is required' },
        { status: 400 },
      );
    }
    if (!chatType || !VALID_CHAT_TYPES.has(chatType)) {
      return NextResponse.json(
        { error: 'invalid_body', message: 'chat_type must be dm or group' },
        { status: 400 },
      );
    }
    if (!peerId) {
      return NextResponse.json(
        { error: 'invalid_body', message: 'peer_id is required' },
        { status: 400 },
      );
    }
    if (!senderId) {
      return NextResponse.json(
        { error: 'invalid_body', message: 'sender_id is required' },
        { status: 400 },
      );
    }

    const gw = await getGateway();
    const routeTable = gw.getRouteTable();
    if (!routeTable) {
      return NextResponse.json(
        { error: 'gateway_not_ready' },
        { status: 503 },
      );
    }

    const route = routeTable.resolve(
      channel,
      accountId,
      chatType as 'dm' | 'group',
      peerId,
      threadId,
    );

    const blockers: Blocker[] = [];

    if (!route) {
      const detail = threadId
        ? ` (channel=${channel}, account=${accountId}, ${chatType} ${peerId}, topic=${threadId})`
        : ` (channel=${channel}, account=${accountId}, ${chatType} ${peerId})`;
      blockers.push({
        stage: 'route',
        reason: `no agent route matches this peer${detail}`,
      });
      return NextResponse.json({
        matched: false,
        agent_id: null,
        session_key: null,
        blockers,
      });
    }

    const matchedAgentId = route.agentId;

    if (matchedAgentId !== agentId) {
      blockers.push({
        stage: 'route',
        reason: `route is owned by another agent: "${matchedAgentId}"`,
      });
    }

    if (route.mentionOnly && !mentionedBot) {
      blockers.push({
        stage: 'mention',
        reason: 'route requires @-mention but message did not include one',
      });
    }

    const agent = gw.getAgent(matchedAgentId);
    const cfg = agent?.config as
      | {
          pairing?: { mode?: string };
          allowlist?: Record<string, string[]>;
        }
      | undefined;

    const pairingMode = cfg?.pairing?.mode ?? 'off';
    const channelAllowlist = cfg?.allowlist?.[channel];
    const inAllowlist = Array.isArray(channelAllowlist)
      && (channelAllowlist.includes(senderId) || channelAllowlist.includes('*'));

    if (!cfg?.pairing && !cfg?.allowlist) {
      // open by default — route layer is the gate
    } else if (inAllowlist) {
      // allowlisted senders always pass
    } else if (pairingMode === 'open') {
      // open auto-approves any sender
    } else if (pairingMode === 'code') {
      blockers.push({
        stage: 'access',
        reason: 'sender not allowlisted; pairing.mode is "code" (sender must pair via code first)',
      });
    } else if (pairingMode === 'approve') {
      blockers.push({
        stage: 'access',
        reason: 'sender not allowlisted; pairing.mode is "approve" (awaiting manual approval)',
      });
    } else {
      blockers.push({
        stage: 'access',
        reason: 'sender not allowlisted; pairing.mode is "off" (denies everyone not in allowlist)',
      });
    }

    const sessionKey = buildSessionKey(
      matchedAgentId,
      channel,
      chatType,
      peerId,
      threadId,
    );

    return NextResponse.json({
      matched: blockers.length === 0,
      agent_id: matchedAgentId,
      session_key: sessionKey,
      blockers,
    });
  });
}
