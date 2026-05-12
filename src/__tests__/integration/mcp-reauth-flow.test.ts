import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOnboarding } from '../../integrations/mcp-onboarding/index.js';
import type { OnboardingEvent } from '../../integrations/mcp-onboarding/index.js';
import type { PendingStore } from '../../integrations/mcp-onboarding/pending-store.js';
import { EncryptedFilesystemCredentialStore } from '../../agent/credentials/encrypted-fs-store.js';
import { CredentialAuditLog } from '../../agent/credentials/audit.js';
import type { McpOAuthCredential } from '../../agent/credentials/index.js';
import { Gateway } from '../../gateway.js';

/**
 * Phase 6 / Task 27 — runtime 401 trap flow.
 *
 * Verifies that:
 *   1. `markReauthRequired` flips `metadata.needs_reauth = '1'` on the
 *      mcp_oauth credential.
 *   2. The `reauth_required` event fires and the Gateway subscriber
 *      dispatches a synthetic `[system] mcp_reauth_required` into the
 *      originating agent session.
 *   3. Admin-initiated rows (no agentSessionKey) produce no dispatch.
 *
 * We don't spin up the SDK; instead we instantiate the onboarding facade
 * with the real credential store and a no-op pending store, and patch the
 * Gateway's dispatch helper to a recording spy — mirroring the convention
 * in `src/__tests__/gateway-mcp-dispatch.test.ts`.
 */

const KEY = 'e'.repeat(64);
const ORIGINAL_AGENTS_DIR = process.env.OC_AGENTS_DIR;
const ORIGINAL_DATA_DIR = process.env.OC_DATA_DIR;
const ORIGINAL_MASTER_KEY = process.env.ANTHROCLAW_MASTER_KEY;

interface DispatchCall {
  targetAgentId: string;
  channel: string;
  peerId: string;
  text: string;
  senderId?: string;
  senderName?: string;
  syntheticSource?: string;
  meta?: Record<string, unknown>;
}

interface GatewayInternals {
  agents: Map<string, unknown>;
  queryAgent: (...args: unknown[]) => Promise<unknown>;
  dispatchSyntheticInbound: (...args: unknown[]) => Promise<unknown>;
  subscribeMcpOnboardingEvents: (onboarding: { events: EventEmitter }) => void;
}

let dir: string;
let store: EncryptedFilesystemCredentialStore;

function makeNoopPending(): PendingStore {
  return {
    insert: () => undefined,
    byId: () => null,
    consumeByState: () => null,
    markCompleted: () => undefined,
    markFailed: () => undefined,
    markCancelled: () => undefined,
    list: () => [],
    sweepExpired: () => [],
    close: () => undefined,
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mcp-reauth-'));
  process.env.OC_AGENTS_DIR = dir;
  process.env.OC_DATA_DIR = dir;
  process.env.ANTHROCLAW_MASTER_KEY = KEY;
  mkdirSync(join(dir, 'amina'));
  store = new EncryptedFilesystemCredentialStore(
    new CredentialAuditLog(join(dir, 'audit.log')),
  );
});

afterEach(() => {
  if (ORIGINAL_AGENTS_DIR === undefined) delete process.env.OC_AGENTS_DIR;
  else process.env.OC_AGENTS_DIR = ORIGINAL_AGENTS_DIR;
  if (ORIGINAL_DATA_DIR === undefined) delete process.env.OC_DATA_DIR;
  else process.env.OC_DATA_DIR = ORIGINAL_DATA_DIR;
  if (ORIGINAL_MASTER_KEY === undefined) delete process.env.ANTHROCLAW_MASTER_KEY;
  else process.env.ANTHROCLAW_MASTER_KEY = ORIGINAL_MASTER_KEY;
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function flushMicrotasks(): Promise<void> {
  return new Promise((r) => setImmediate(r));
}

describe('mcp runtime 401 trap → reauth_required dispatch', () => {
  it('markReauthRequired flips needs_reauth and dispatches synthetic message (chat-initiated)', async () => {
    await store.set(
      { agentId: 'amina', service: 'mcp:notion' },
      {
        kind: 'mcp_oauth',
        service: 'mcp:notion',
        account: 'notion',
        scopes: [],
        mcpUrl: 'https://notion/mcp',
        accessToken: 'expired_or_revoked',
        refreshToken: 'rt',
        expiresAt: Date.now() + 24 * 3600_000,
        tokenEndpoint: 'https://notion/oauth/token',
        clientId: 'cid',
        createdAt: Date.now(),
      } satisfies McpOAuthCredential,
    );

    const onboarding = createOnboarding({
      pending: makeNoopPending(),
      credentials: store,
      uiBaseUrl: 'http://localhost:3000',
      listTakenServerIds: async () => new Set(),
    });

    const calls: DispatchCall[] = [];
    const gw = new Gateway() as unknown as GatewayInternals;
    gw.agents = new Map([['amina', { id: 'amina', config: {} }]]);
    gw.queryAgent = vi.fn(async () => 'ok');
    gw.dispatchSyntheticInbound = vi.fn(async (...args: unknown[]) => {
      calls.push(args[0] as DispatchCall);
      return { messageId: 'm1', sessionKey: 'amina:telegram:dm:123456' };
    });
    gw.subscribeMcpOnboardingEvents(onboarding);

    await onboarding.markReauthRequired({
      agentId: 'amina',
      serverId: 'notion',
      agentSessionKey: 'amina:telegram:dm:123456',
    });
    await flushMicrotasks();

    // 1. Credential flipped.
    const reread = (await store.get(
      { agentId: 'amina', service: 'mcp:notion' },
      'test',
    )) as McpOAuthCredential;
    expect(reread.metadata?.needs_reauth).toBe('1');

    // 2. Synthetic dispatch fired with the expected body.
    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call.targetAgentId).toBe('amina');
    expect(call.channel).toBe('telegram');
    expect(call.peerId).toBe('123456');
    expect(call.text).toBe(
      '[system] mcp_reauth_required: notion\n'
        + 'server_id: notion\n'
        + 'reason: token_invalid_or_revoked',
    );
    expect(call.senderId).toBe('mcp-onboarding');
    expect(call.senderName).toBe('mcp-onboarding');
    expect(call.syntheticSource).toBe('mcp_onboarding');
    expect(call.meta?.source).toBe('mcp_reauth_required');
    expect(call.meta?.serverId).toBe('notion');
  });

  it('admin-initiated (no agentSessionKey): credential flips but no dispatch', async () => {
    await store.set(
      { agentId: 'amina', service: 'mcp:notion' },
      {
        kind: 'mcp_oauth',
        service: 'mcp:notion',
        account: 'notion',
        scopes: [],
        mcpUrl: 'https://notion/mcp',
        accessToken: 'expired_or_revoked',
        refreshToken: 'rt',
        expiresAt: Date.now() + 24 * 3600_000,
        tokenEndpoint: 'https://notion/oauth/token',
        clientId: 'cid',
        createdAt: Date.now(),
      } satisfies McpOAuthCredential,
    );

    const onboarding = createOnboarding({
      pending: makeNoopPending(),
      credentials: store,
      uiBaseUrl: 'http://localhost:3000',
      listTakenServerIds: async () => new Set(),
    });

    const calls: DispatchCall[] = [];
    const gw = new Gateway() as unknown as GatewayInternals;
    gw.agents = new Map([['amina', { id: 'amina', config: {} }]]);
    gw.queryAgent = vi.fn(async () => 'ok');
    gw.dispatchSyntheticInbound = vi.fn(async (...args: unknown[]) => {
      calls.push(args[0] as DispatchCall);
      return { messageId: 'm1', sessionKey: '' };
    });
    gw.subscribeMcpOnboardingEvents(onboarding);

    await onboarding.markReauthRequired({
      agentId: 'amina',
      serverId: 'notion',
      agentSessionKey: null,
    });
    await flushMicrotasks();

    const reread = (await store.get(
      { agentId: 'amina', service: 'mcp:notion' },
      'test',
    )) as McpOAuthCredential;
    expect(reread.metadata?.needs_reauth).toBe('1');
    expect(calls).toHaveLength(0);
  });

  it('emits reauth_required event with expected payload', async () => {
    await store.set(
      { agentId: 'amina', service: 'mcp:notion' },
      {
        kind: 'mcp_oauth',
        service: 'mcp:notion',
        account: 'notion',
        scopes: [],
        mcpUrl: 'https://notion/mcp',
        accessToken: 'x',
        refreshToken: 'rt',
        tokenEndpoint: 'https://notion/oauth/token',
        clientId: 'cid',
        createdAt: Date.now(),
      } satisfies McpOAuthCredential,
    );

    const onboarding = createOnboarding({
      pending: makeNoopPending(),
      credentials: store,
      uiBaseUrl: 'http://localhost:3000',
      listTakenServerIds: async () => new Set(),
    });

    const events: OnboardingEvent[] = [];
    onboarding.events.on('reauth_required', (evt: OnboardingEvent) => {
      events.push(evt);
    });

    await onboarding.markReauthRequired({
      agentId: 'amina',
      serverId: 'notion',
      agentSessionKey: 'amina:telegram:dm:42',
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      agentId: 'amina',
      serverId: 'notion',
      agentSessionKey: 'amina:telegram:dm:42',
    });
  });

  it('tolerates missing credential — still emits the event', async () => {
    const onboarding = createOnboarding({
      pending: makeNoopPending(),
      credentials: store,
      uiBaseUrl: 'http://localhost:3000',
      listTakenServerIds: async () => new Set(),
    });

    const events: OnboardingEvent[] = [];
    onboarding.events.on('reauth_required', (evt: OnboardingEvent) => {
      events.push(evt);
    });

    // Don't pre-seed the credential — facade should swallow the read error.
    await onboarding.markReauthRequired({
      agentId: 'amina',
      serverId: 'ghost',
      agentSessionKey: null,
    });

    expect(events).toHaveLength(1);
    expect(events[0].serverId).toBe('ghost');
  });
});
