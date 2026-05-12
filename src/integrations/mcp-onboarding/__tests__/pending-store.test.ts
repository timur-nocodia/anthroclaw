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
});
