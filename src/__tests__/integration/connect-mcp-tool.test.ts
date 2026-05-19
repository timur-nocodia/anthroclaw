/**
 * Integration test for Phase 5 Task 23: events emitted by the onboarding
 * facade reach a Gateway-style subscriber as `[system] mcp_*` synthetic
 * inbound messages.
 *
 * Rather than spinning up a full Gateway (heavy + tangled with the SDK
 * runtime), this test exercises the same code path the production
 * subscriber follows:
 *   - real `createOnboarding` facade with a real pending store
 *   - completes a pending row directly (mimics the OAuth callback)
 *   - asserts the `connected` event is emitted with the expected payload
 *   - drives a faux `dispatchSyntheticInbound` from a subscriber that
 *     uses the same string format Gateway.subscribeMcpOnboardingEvents
 *     uses, and verifies the four expected fields land:
 *       - `[system] mcp_connected: <serverId>` prefix
 *       - `meta.source === 'mcp_oauth_callback'`
 *       - dispatched to the agent's session
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOnboarding, type OnboardingEvent } from '../../integrations/mcp-onboarding/index.js';
import { openPendingStore, type PendingConnection, type PendingStore } from '../../integrations/mcp-onboarding/pending-store.js';
import { EncryptedFilesystemCredentialStore } from '../../agent/credentials/encrypted-fs-store.js';
import { CredentialAuditLog } from '../../agent/credentials/audit.js';

const KEY = 'd'.repeat(64);
const ORIGINAL_AGENTS_DIR = process.env.OC_AGENTS_DIR;
const ORIGINAL_DATA_DIR = process.env.OC_DATA_DIR;
const ORIGINAL_MASTER_KEY = process.env.ANTHROCLAW_MASTER_KEY;

let dir: string;
let pending: PendingStore;
let onboarding: ReturnType<typeof createOnboarding>;

interface DispatchCall {
  targetAgentId: string;
  channel: string;
  peerId: string;
  text: string;
  meta?: Record<string, unknown>;
}

const dispatched: DispatchCall[] = [];

function subscribe(onboarding: ReturnType<typeof createOnboarding>): void {
  // Mirror the format produced by Gateway.subscribeMcpOnboardingEvents.
  onboarding.events.on('connected', (evt: OnboardingEvent) => {
    if (!evt.agentSessionKey) return;
    const parts = evt.agentSessionKey.split(':');
    if (parts.length < 4) return;
    const [, channel, , peerId] = parts;
    const toolNames = (evt.tools ?? []).map((t) => t.name).join(', ');
    dispatched.push({
      targetAgentId: evt.agentId,
      channel,
      peerId,
      text:
        `[system] mcp_connected: ${evt.serverId}\n`
        + `server_id: ${evt.serverId}\n`
        + `pending_id: ${evt.pendingId}\n`
        + `tools: ${toolNames}\n`
        + 'awaiting: finalize',
      meta: {
        source: 'mcp_oauth_callback',
        pendingId: evt.pendingId,
        serverId: evt.serverId,
      },
    });
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mcp-int-'));
  process.env.OC_AGENTS_DIR = dir;
  process.env.OC_DATA_DIR = dir;
  process.env.ANTHROCLAW_MASTER_KEY = KEY;
  mkdirSync(join(dir, 'agent_alpha'));
  writeFileSync(
    join(dir, 'agent_alpha', 'agent.yml'),
    'model: claude-sonnet-4-5\nroutes: []\n',
  );
  pending = openPendingStore(join(dir, 'mcp.sqlite'));
  const credentials = new EncryptedFilesystemCredentialStore(
    new CredentialAuditLog(join(dir, 'audit.log')),
  );
  onboarding = createOnboarding({
    pending,
    credentials,
    uiBaseUrl: 'https://ui.test',
    listTakenServerIds: async () => new Set<string>(),
  });
  subscribe(onboarding);
  dispatched.length = 0;
});

afterEach(() => {
  pending.close();
  if (ORIGINAL_AGENTS_DIR === undefined) delete process.env.OC_AGENTS_DIR;
  else process.env.OC_AGENTS_DIR = ORIGINAL_AGENTS_DIR;
  if (ORIGINAL_DATA_DIR === undefined) delete process.env.OC_DATA_DIR;
  else process.env.OC_DATA_DIR = ORIGINAL_DATA_DIR;
  if (ORIGINAL_MASTER_KEY === undefined) delete process.env.ANTHROCLAW_MASTER_KEY;
  else process.env.ANTHROCLAW_MASTER_KEY = ORIGINAL_MASTER_KEY;
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

describe('mcp onboarding → gateway synthetic dispatch wiring', () => {
  it('emits `connected` after completeOAuth and the subscriber dispatches a [system] mcp_connected message', async () => {
    const now = Date.now();
    const fakeOauthMeta = JSON.stringify({
      authorizationEndpoint: 'https://auth.test/authorize',
      tokenEndpoint: 'https://auth.test/token',
      issuer: 'https://auth.test',
      resource: 'https://mcp.test/mcp',
    });
    const row: PendingConnection = {
      id: 'pnd_chat',
      state: 'st_chat_xyz',
      agentId: 'agent_alpha',
      // A real chat-driven session key — the subscriber decomposes this to
      // route the synthetic inbound back to the correct channel + peer.
      agentSessionKey: 'agent_alpha:telegram:dm:123456',
      mcpUrl: 'https://mcp.test/mcp',
      authMode: 'oauth',
      codeVerifier: 'v_test',
      clientId: 'cli_test',
      clientSecret: null,
      oauthMetadata: fakeOauthMeta,
      toolsMetadata: null,
      requestedBy: 'agent:agent_alpha:telegram:dm:123456',
      status: 'pending',
      failureReason: null,
      createdAt: now,
      expiresAt: now + 60_000,
    };
    pending.insert(row);

    // Stub fetch: /token (exchange code) returns access+refresh; the
    // subsequent tools/list returns one tool.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url, init) => {
        const u = String(url);
        if (u.endsWith('/token')) {
          return new Response(
            JSON.stringify({
              access_token: 'access_xyz',
              refresh_token: 'refresh_xyz',
              expires_in: 3600,
              scope: 'read',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        // tools/list against the MCP url
        const body = JSON.parse((init?.body as string) ?? '{}');
        if (body.method === 'tools/list') {
          return new Response(
            JSON.stringify({
              result: {
                tools: [{ name: 'demo_tool', description: 'a demo' }],
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response('{}', { status: 200 });
      }),
    );

    const res = await onboarding.completeOAuth({
      state: 'st_chat_xyz',
      code: 'authcode_xyz',
    });
    expect(res.status).toBe('completed');

    // Subscriber should have produced exactly one dispatch.
    expect(dispatched).toHaveLength(1);
    const call = dispatched[0];
    expect(call.targetAgentId).toBe('agent_alpha');
    expect(call.channel).toBe('telegram');
    expect(call.peerId).toBe('123456');
    expect(call.text).toMatch(/^\[system\] mcp_connected: /);
    expect(call.text).toContain('pending_id: pnd_chat');
    expect(call.text).toContain('tools: demo_tool');
    expect(call.text).toContain('awaiting: finalize');
    expect(call.meta?.source).toBe('mcp_oauth_callback');
    expect(call.meta?.queueMode).toBeUndefined();
    expect(call.meta?.pendingId).toBe('pnd_chat');
  });

  it('does NOT dispatch when the pending row has no agentSessionKey (admin-initiated)', async () => {
    const now = Date.now();
    const fakeOauthMeta = JSON.stringify({
      authorizationEndpoint: 'https://auth.test/authorize',
      tokenEndpoint: 'https://auth.test/token',
      issuer: 'https://auth.test',
      resource: 'https://mcp.test/mcp',
    });
    pending.insert({
      id: 'pnd_admin',
      state: 'st_admin_xyz',
      agentId: 'agent_alpha',
      agentSessionKey: null,
      mcpUrl: 'https://mcp.test/mcp',
      authMode: 'oauth',
      codeVerifier: 'v_admin',
      clientId: 'cli_test',
      clientSecret: null,
      oauthMetadata: fakeOauthMeta,
      toolsMetadata: null,
      requestedBy: 'admin:u1',
      status: 'pending',
      failureReason: null,
      createdAt: now,
      expiresAt: now + 60_000,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url, init) => {
        const u = String(url);
        if (u.endsWith('/token')) {
          return new Response(
            JSON.stringify({
              access_token: 'a',
              refresh_token: 'r',
              expires_in: 3600,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        const body = JSON.parse((init?.body as string) ?? '{}');
        if (body.method === 'tools/list') {
          return new Response(
            JSON.stringify({ result: { tools: [{ name: 'demo_tool' }] } }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response('{}', { status: 200 });
      }),
    );

    const res = await onboarding.completeOAuth({
      state: 'st_admin_xyz',
      code: 'authcode_admin',
    });
    expect(res.status).toBe('completed');
    expect(dispatched).toHaveLength(0);
  });

  it('emits `failed` with the original mcpUrl as serverId when completeOAuth fails after consume', async () => {
    const now = Date.now();
    pending.insert({
      id: 'pnd_fail',
      state: 'st_fail',
      agentId: 'agent_alpha',
      agentSessionKey: 'agent_alpha:telegram:dm:42',
      mcpUrl: 'https://mcp.test/mcp',
      authMode: 'oauth',
      codeVerifier: 'v',
      clientId: 'cli',
      clientSecret: null,
      // intentionally corrupt — completeOAuth will throw invalid_oauth_metadata
      oauthMetadata: 'not-json',
      toolsMetadata: null,
      requestedBy: 'agent:agent_alpha:telegram:dm:42',
      status: 'pending',
      failureReason: null,
      createdAt: now,
      expiresAt: now + 60_000,
    });

    // Capture `failed` events directly (the wiring already attaches a
    // `connected` listener; we want the orthogonal `failed` path).
    const failedEvents: OnboardingEvent[] = [];
    onboarding.events.on('failed', (e: OnboardingEvent) => failedEvents.push(e));

    const res = await onboarding.completeOAuth({
      state: 'st_fail',
      code: 'c',
    });
    expect(res.status).toBe('failed');
    expect(failedEvents).toHaveLength(1);
    expect(failedEvents[0].agentSessionKey).toBe('agent_alpha:telegram:dm:42');
    expect(failedEvents[0].serverId).toBe('https://mcp.test/mcp');
    expect(failedEvents[0].reason).toBeTruthy();
  });
});
