import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCleanup } from '../cleanup.js';
import {
  openPendingStore,
  type PendingStore,
  type PendingConnection,
} from '../pending-store.js';
import type { OnboardingEvent } from '../index.js';

let dir: string;
let pending: PendingStore;

function pendingRow(overrides: Partial<PendingConnection>): PendingConnection {
  const now = overrides.createdAt ?? 1_000_000;
  return {
    id: 'pnd_default',
    state: 'st_default',
    agentId: 'agent_alpha',
    agentSessionKey: null,
    mcpUrl: 'https://mcp.test/mcp',
    authMode: 'oauth',
    codeVerifier: 'v',
    clientId: 'cli',
    clientSecret: null,
    oauthMetadata: '{}',
    toolsMetadata: null,
    requestedBy: 'admin:u1',
    status: 'pending',
    failureReason: null,
    createdAt: now,
    expiresAt: now + 60_000,
    ...overrides,
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mcp-cleanup-'));
  pending = openPendingStore(join(dir, 'mcp.sqlite'));
});

afterEach(() => {
  pending.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('runCleanup', () => {
  it('marks an expired pending row as `expired` and emits a `timeout` event for chat-initiated rows', () => {
    pending.insert(
      pendingRow({
        id: 'pnd_agent',
        state: 'st_agent',
        agentSessionKey: 'agent_alpha:telegram:dm:42',
        requestedBy: 'agent:agent_alpha:telegram:dm:42',
        createdAt: 100,
        expiresAt: 200,
      }),
    );

    const events = new EventEmitter();
    const received: OnboardingEvent[] = [];
    events.on('timeout', (evt: OnboardingEvent) => received.push(evt));

    const swept = runCleanup({ pending, events, now: () => 300 });
    expect(swept).toBe(1);

    const row = pending.byId('pnd_agent');
    expect(row?.status).toBe('expired');
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      pendingId: 'pnd_agent',
      agentId: 'agent_alpha',
      agentSessionKey: 'agent_alpha:telegram:dm:42',
      serverId: 'https://mcp.test/mcp',
    });
  });

  it('does NOT emit a `timeout` for admin-initiated rows (no chat to dispatch into)', () => {
    pending.insert(
      pendingRow({
        id: 'pnd_admin',
        state: 'st_admin',
        agentSessionKey: null,
        requestedBy: 'admin:u1',
        createdAt: 100,
        expiresAt: 200,
      }),
    );

    const events = new EventEmitter();
    const received: OnboardingEvent[] = [];
    events.on('timeout', (evt: OnboardingEvent) => received.push(evt));

    const swept = runCleanup({ pending, events, now: () => 300 });
    expect(swept).toBe(1);

    const row = pending.byId('pnd_admin');
    expect(row?.status).toBe('expired');
    expect(received).toHaveLength(0);
  });

  it('leaves non-expired rows alone', () => {
    pending.insert(
      pendingRow({
        id: 'pnd_fresh',
        state: 'st_fresh',
        agentSessionKey: 'agent_alpha:telegram:dm:1',
        requestedBy: 'agent:agent_alpha:telegram:dm:1',
        createdAt: 100,
        expiresAt: 500,
      }),
    );

    const events = new EventEmitter();
    const received: OnboardingEvent[] = [];
    events.on('timeout', (evt: OnboardingEvent) => received.push(evt));

    const swept = runCleanup({ pending, events, now: () => 300 });
    expect(swept).toBe(0);

    const row = pending.byId('pnd_fresh');
    expect(row?.status).toBe('pending');
    expect(received).toHaveLength(0);
  });

  it('sweeps stuck `exchanging` rows alongside `pending` ones', () => {
    pending.insert(
      pendingRow({
        id: 'pnd_stuck',
        state: 'st_stuck',
        agentSessionKey: 'agent_alpha:telegram:dm:99',
        requestedBy: 'agent:agent_alpha:telegram:dm:99',
        status: 'exchanging',
        createdAt: 100,
        expiresAt: 200,
      }),
    );

    const events = new EventEmitter();
    const received: OnboardingEvent[] = [];
    events.on('timeout', (evt: OnboardingEvent) => received.push(evt));

    const swept = runCleanup({ pending, events, now: () => 300 });
    expect(swept).toBe(1);

    const row = pending.byId('pnd_stuck');
    expect(row?.status).toBe('expired');
    expect(received).toHaveLength(1);
  });

  it('emits one event per chat-initiated expired row in a batch', () => {
    pending.insert(
      pendingRow({
        id: 'pnd_a',
        state: 'st_a',
        agentSessionKey: 'agent_alpha:telegram:dm:1',
        requestedBy: 'agent:agent_alpha:telegram:dm:1',
        createdAt: 100,
        expiresAt: 200,
      }),
    );
    pending.insert(
      pendingRow({
        id: 'pnd_b',
        state: 'st_b',
        agentSessionKey: 'agent_alpha:telegram:dm:2',
        requestedBy: 'agent:agent_alpha:telegram:dm:2',
        createdAt: 100,
        expiresAt: 250,
      }),
    );
    pending.insert(
      pendingRow({
        id: 'pnd_admin',
        state: 'st_admin',
        agentSessionKey: null,
        requestedBy: 'admin:u1',
        createdAt: 100,
        expiresAt: 250,
      }),
    );

    const events = new EventEmitter();
    const received: OnboardingEvent[] = [];
    events.on('timeout', (evt: OnboardingEvent) => received.push(evt));

    const swept = runCleanup({ pending, events, now: () => 300 });
    expect(swept).toBe(3);
    expect(received).toHaveLength(2);
    expect(received.map((e) => e.pendingId).sort()).toEqual(['pnd_a', 'pnd_b']);
  });

  it('defaults `now` to Date.now() when not supplied', () => {
    // Row that's clearly expired vs real wall clock.
    pending.insert(
      pendingRow({
        id: 'pnd_old',
        state: 'st_old',
        agentSessionKey: null,
        requestedBy: 'admin:u1',
        createdAt: 0,
        expiresAt: 1,
      }),
    );
    const events = new EventEmitter();
    const swept = runCleanup({ pending, events });
    expect(swept).toBe(1);
    expect(pending.byId('pnd_old')?.status).toBe('expired');
  });
});
