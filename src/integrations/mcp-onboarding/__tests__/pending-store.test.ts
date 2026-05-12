import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  openPendingStore,
  type PendingStore,
  type PendingConnection,
} from '../pending-store.js';

describe('PendingStore', () => {
  let dir: string;
  let store: PendingStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mcp-pending-'));
    store = openPendingStore(join(dir, 'mcp.sqlite'));
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates schema on first open', () => {
    expect(store.list()).toEqual([]);
  });

  const make = (
    overrides: Partial<PendingConnection> = {},
  ): PendingConnection => ({
    id: 'pnd_' + Math.random().toString(36).slice(2, 10),
    state: 'st_' + Math.random().toString(36).slice(2, 10),
    agentId: 'a1',
    agentSessionKey: null,
    mcpUrl: 'https://mcp.postmypost.io/mcp',
    authMode: 'oauth',
    codeVerifier: 'verifier',
    clientId: 'cli',
    clientSecret: null,
    oauthMetadata: null,
    toolsMetadata: null,
    requestedBy: 'admin:user1',
    status: 'pending',
    failureReason: null,
    createdAt: Date.now(),
    expiresAt: Date.now() + 600_000,
    ...overrides,
  });

  it('insert + byId roundtrip', () => {
    const row = make();
    store.insert(row);
    expect(store.byId(row.id)).toEqual(row);
  });

  it('list returns rows in newest-first order', () => {
    const older = make({ createdAt: 1 });
    const newer = make({ createdAt: 2 });
    store.insert(older);
    store.insert(newer);
    expect(store.list().map((r) => r.id)).toEqual([newer.id, older.id]);
  });

  it('sweepExpired only sweeps pending rows past expiry', () => {
    const expiredPending = make({ expiresAt: 1 });
    const expiredCompleted = make({ expiresAt: 1, status: 'completed' });
    const live = make({ expiresAt: Date.now() + 10_000 });
    store.insert(expiredPending);
    store.insert(expiredCompleted);
    store.insert(live);
    const swept = store.sweepExpired(Date.now());
    expect(swept.map((r) => r.id)).toEqual([expiredPending.id]);
    expect(store.byId(expiredPending.id)?.status).toBe('expired');
    expect(store.byId(expiredCompleted.id)?.status).toBe('completed');
  });

  it('sweepExpired also recovers stuck exchanging rows', () => {
    // If the process crashes between `consumeByState` (which sets status to
    // 'exchanging') and `markCompleted`/`markCancelled`, the row would stay
    // stuck forever without this guard.
    const now = Date.now();
    const stuck = make({ expiresAt: now - 1000, status: 'exchanging' });
    store.insert(stuck);
    const swept = store.sweepExpired(now);
    expect(swept.map((r) => r.id)).toContain(stuck.id);
    expect(store.byId(stuck.id)?.status).toBe('expired');
  });

  it('consumeByState is atomic — exactly one of 10 concurrent consumers wins', async () => {
    const row = make({ status: 'pending' });
    store.insert(row);
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        Promise.resolve().then(() => store.consumeByState(row.state)),
      ),
    );
    const winners = results.filter((r) => r !== null);
    expect(winners).toHaveLength(1);
    expect(store.byId(row.id)?.status).toBe('exchanging');
  });

  it('consumeByState returns null for nonexistent state', () => {
    expect(store.consumeByState('nonexistent')).toBeNull();
  });

  it('consumeByState returns null when status is not pending', () => {
    const row = make({ status: 'completed' });
    store.insert(row);
    expect(store.consumeByState(row.state)).toBeNull();
  });

  it('markCompleted clears code_verifier and client_secret', () => {
    const row = make({
      codeVerifier: 'verifier_secret',
      clientSecret: 'client_secret_value',
      oauthMetadata: '{"issuer":"https://auth/"}',
    });
    store.insert(row);
    store.markCompleted(row.id, JSON.stringify({ tools: [], serverId: 'x' }));
    const after = store.byId(row.id);
    expect(after?.status).toBe('completed');
    expect(after?.codeVerifier).toBeNull();
    expect(after?.clientSecret).toBeNull();
    expect(after?.toolsMetadata).toBeTruthy();
  });

  it('markFailed clears code_verifier, client_secret, oauth_metadata', () => {
    const row = make({
      codeVerifier: 'verifier_secret',
      clientSecret: 'client_secret_value',
      oauthMetadata: '{"issuer":"https://auth/"}',
    });
    store.insert(row);
    store.markFailed(row.id, 'some_reason');
    const after = store.byId(row.id);
    expect(after?.status).toBe('failed');
    expect(after?.failureReason).toBe('some_reason');
    expect(after?.codeVerifier).toBeNull();
    expect(after?.clientSecret).toBeNull();
    expect(after?.oauthMetadata).toBeNull();
  });

  it('markCancelled clears code_verifier, client_secret, oauth_metadata', () => {
    const row = make({
      codeVerifier: 'verifier_secret',
      clientSecret: 'client_secret_value',
      oauthMetadata: '{"issuer":"https://auth/"}',
    });
    store.insert(row);
    store.markCancelled(row.id, 'user_denied');
    const after = store.byId(row.id);
    expect(after?.status).toBe('cancelled');
    expect(after?.failureReason).toBe('user_denied');
    expect(after?.codeVerifier).toBeNull();
    expect(after?.clientSecret).toBeNull();
    expect(after?.oauthMetadata).toBeNull();
  });
});
