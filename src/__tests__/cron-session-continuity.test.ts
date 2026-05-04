import { describe, it, expect } from 'vitest';
import { Gateway } from '../gateway.js';
import { buildSessionKey } from '../routing/session-key.js';
import type { ScheduledJob } from '../cron/scheduler.js';

/**
 * Bug #1 (2026-05-04): cron-fired briefing went to UUID-A, the user's reply
 * right after went to UUID-B, so the agent had no recollection of the
 * briefing it just sent.
 *
 * Root cause: handleCronJob uses the cron-shaped sessionKey
 *   `${agentId}:cron:${jobId}`
 * but a subsequent user reply via Telegram dispatch builds the user-shaped
 * sessionKey via buildSessionKey(agentId, channel, 'dm', peerId) — different
 * key, different SDK session.
 *
 * Fix (Task 9, v0.8.0): after queryAgent returns inside handleCronJob, mirror
 * the captured SDK session id under the user-shaped sessionKey when deliverTo
 * is DM-shaped. The cron sessionKey is preserved for cron control/logging.
 *
 * These tests exercise the extracted helper
 * `Gateway.mirrorCronSessionToUserKey(agent, cronSessionKey, deliverTo)` in
 * isolation. Spinning up a full Gateway harness with a mocked SDK `query()`
 * would be far heavier and would not improve confidence in the binding logic
 * itself, which is what's actually changing.
 */

interface FakeAgent {
  id: string;
  sessions: Map<string, string>;
  getSessionId(key: string): string | undefined;
  setSessionId(key: string, id: string): void;
}

function makeFakeAgent(id: string): FakeAgent {
  const sessions = new Map<string, string>();
  return {
    id,
    sessions,
    getSessionId(key) {
      return sessions.get(key);
    },
    setSessionId(key, sessionId) {
      sessions.set(key, sessionId);
    },
  };
}

type DeliverTo = ScheduledJob['deliverTo'];

function callMirror(
  agent: FakeAgent,
  cronSessionKey: string,
  deliverTo: DeliverTo,
): void {
  // Helper is a private method on Gateway. Access via prototype to avoid
  // building a full Gateway instance (which boots channels, plugins, SDK).
  const fn = (Gateway.prototype as unknown as Record<string, unknown>).mirrorCronSessionToUserKey;
  if (typeof fn !== 'function') {
    throw new Error('Gateway.mirrorCronSessionToUserKey not implemented');
  }
  // No `this`-state is read by the helper — it only touches the agent param.
  (fn as (a: unknown, k: string, d: DeliverTo) => void).call(
    {} as unknown,
    agent,
    cronSessionKey,
    deliverTo,
  );
}

describe('Gateway.mirrorCronSessionToUserKey — DM cron session continuity (Bug #1)', () => {
  const agentId = 'amina';
  const cronJobId = 'morning-briefing';
  const cronSessionKey = `${agentId}:cron:${cronJobId}`;
  const sdkSessionId = 'sdk-session-cron';
  const deliverToDm: DeliverTo = {
    channel: 'telegram',
    peer_id: '12345',
    account_id: 'main',
  };

  it('mirrors the captured SDK session id under the user DM sessionKey when deliverTo is DM-shaped', () => {
    const agent = makeFakeAgent(agentId);
    // Simulate: queryAgent already bound sdk-session-cron under the cron key.
    agent.setSessionId(cronSessionKey, sdkSessionId);

    callMirror(agent, cronSessionKey, deliverToDm);

    const userKey = buildSessionKey(agentId, 'telegram', 'dm', '12345');
    expect(agent.getSessionId(userKey)).toBe(sdkSessionId);
    // Cron key is preserved (still needed for cron control/logging registry).
    expect(agent.getSessionId(cronSessionKey)).toBe(sdkSessionId);
  });

  it('mirrors thread_id when deliverTo includes one', () => {
    const agent = makeFakeAgent(agentId);
    agent.setSessionId(cronSessionKey, sdkSessionId);

    callMirror(agent, cronSessionKey, {
      channel: 'telegram',
      peer_id: '12345',
      account_id: 'main',
      thread_id: 'topic-7',
    });

    const userKey = buildSessionKey(agentId, 'telegram', 'dm', '12345', 'topic-7');
    expect(agent.getSessionId(userKey)).toBe(sdkSessionId);
  });

  it('does NOT bind any user key when deliverTo is undefined (background cron)', () => {
    const agent = makeFakeAgent(agentId);
    agent.setSessionId(cronSessionKey, sdkSessionId);

    callMirror(agent, cronSessionKey, undefined);

    // Only the cron key should exist; nothing else mirrored.
    expect(Array.from(agent.sessions.keys())).toEqual([cronSessionKey]);
  });

  it('does nothing if the cron key has no captured SDK session id', () => {
    const agent = makeFakeAgent(agentId);
    // No setSessionId — simulates queryAgent never capturing an init event.

    callMirror(agent, cronSessionKey, deliverToDm);

    expect(agent.sessions.size).toBe(0);
  });

  it('does not re-bind when the user key already equals the cron key (paranoia guard)', () => {
    const agent = makeFakeAgent(agentId);
    // Pathological case: cron key happens to match the user key shape.
    const userKey = buildSessionKey(agentId, 'telegram', 'dm', '12345');
    agent.setSessionId(userKey, sdkSessionId);

    // Pretend the cron key IS the user key — guard should no-op.
    callMirror(agent, userKey, deliverToDm);

    expect(agent.sessions.size).toBe(1);
    expect(agent.getSessionId(userKey)).toBe(sdkSessionId);
  });

  // Group-cron continuity is deferred to v0.9.0 (group_sessions config — shared
  // vs per_user — is needed to resolve the user-side group sessionKey, and
  // job.deliverTo doesn't carry that context). For now group cron creates a
  // fresh user session if/when a group member replies.
});
