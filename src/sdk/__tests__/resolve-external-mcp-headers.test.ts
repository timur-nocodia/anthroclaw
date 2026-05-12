import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveExternalMcpHeaders } from '../external-mcp.js';
import { EncryptedFilesystemCredentialStore } from '../../agent/credentials/encrypted-fs-store.js';
import { CredentialAuditLog } from '../../agent/credentials/audit.js';
import type { McpOAuthCredential } from '../../agent/credentials/index.js';

const KEY = 'd'.repeat(64);
const ORIGINAL_AGENTS_DIR = process.env.OC_AGENTS_DIR;
const ORIGINAL_DATA_DIR = process.env.OC_DATA_DIR;
const ORIGINAL_MASTER_KEY = process.env.ANTHROCLAW_MASTER_KEY;

describe('resolveExternalMcpHeaders', () => {
  let dir: string;
  let store: EncryptedFilesystemCredentialStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mcp-resolve-'));
    process.env.OC_AGENTS_DIR = dir;
    process.env.OC_DATA_DIR = dir;
    process.env.ANTHROCLAW_MASTER_KEY = KEY;
    mkdirSync(join(dir, 'a1'));
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
  });

  it('injects Bearer header from mcp_apikey credential', async () => {
    await store.set(
      { agentId: 'a1', service: 'mcp:pmp' },
      {
        kind: 'mcp_apikey',
        service: 'mcp:pmp',
        account: 'pmp',
        scopes: [],
        mcpUrl: 'https://mcp.postmypost.io/mcp',
        token: 'sk_live',
        scheme: 'Bearer',
        createdAt: Date.now(),
      },
    );
    const out = await resolveExternalMcpHeaders(
      {
        postmypost: {
          type: 'http',
          url: 'https://mcp.postmypost.io/mcp',
          credential_ref: 'mcp:pmp',
        },
      },
      store,
      { agentId: 'a1' },
    );
    expect(out.postmypost?.type).toBe('http');
    const entry = out.postmypost;
    if (entry && (entry.type === 'http' || entry.type === 'sse')) {
      expect(entry.headers?.Authorization).toBe('Bearer sk_live');
    }
  });

  it('uses custom scheme when credential supplies one', async () => {
    await store.set(
      { agentId: 'a1', service: 'mcp:custom' },
      {
        kind: 'mcp_apikey',
        service: 'mcp:custom',
        account: 'custom',
        scopes: [],
        mcpUrl: 'https://x',
        token: 't',
        scheme: 'Token',
        createdAt: Date.now(),
      },
    );
    const out = await resolveExternalMcpHeaders(
      { c: { type: 'http', url: 'https://x', credential_ref: 'mcp:custom' } },
      store,
      { agentId: 'a1' },
    );
    const entry = out.c;
    if (entry && (entry.type === 'http' || entry.type === 'sse')) {
      expect(entry.headers?.Authorization).toBe('Token t');
    }
  });

  it('injects Bearer header from mcp_oauth credential', async () => {
    await store.set(
      { agentId: 'a1', service: 'mcp:oa' },
      {
        kind: 'mcp_oauth',
        service: 'mcp:oa',
        account: 'oa',
        scopes: [],
        mcpUrl: 'https://x',
        accessToken: 'tok_a',
        refreshToken: 'tok_r',
        createdAt: Date.now(),
      },
    );
    const out = await resolveExternalMcpHeaders(
      { oa: { type: 'http', url: 'https://x', credential_ref: 'mcp:oa' } },
      store,
      { agentId: 'a1' },
    );
    const entry = out.oa;
    if (entry && (entry.type === 'http' || entry.type === 'sse')) {
      expect(entry.headers?.Authorization).toBe('Bearer tok_a');
    }
  });

  it('passes through entries without credential_ref unchanged', async () => {
    const out = await resolveExternalMcpHeaders(
      {
        legacy: {
          type: 'http',
          url: 'https://x/y',
          headers: { Authorization: 'Bearer pre' },
        },
      },
      store,
      { agentId: 'a1' },
    );
    const entry = out.legacy;
    if (entry && (entry.type === 'http' || entry.type === 'sse')) {
      expect(entry.headers?.Authorization).toBe('Bearer pre');
    }
  });

  it('passes through stdio entries unchanged', async () => {
    const out = await resolveExternalMcpHeaders(
      { local: { type: 'stdio', command: '/bin/cat' } },
      store,
      { agentId: 'a1' },
    );
    expect(out.local?.type).toBe('stdio');
  });

  it('skips entry whose credential cannot be resolved', async () => {
    const out = await resolveExternalMcpHeaders(
      {
        missing: {
          type: 'http',
          url: 'https://x',
          credential_ref: 'mcp:nope',
        },
      },
      store,
      { agentId: 'a1' },
    );
    expect(out.missing).toBeUndefined();
  });

  it('returns empty record for undefined spec', async () => {
    const out = await resolveExternalMcpHeaders(undefined, store, {
      agentId: 'a1',
    });
    expect(out).toEqual({});
  });

  describe('mcp_oauth pre-flight refresh', () => {
    const ORIGINAL_FETCH = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = ORIGINAL_FETCH;
    });

    it('refreshes mcp_oauth credential when expiresAt within 5min window', async () => {
      await store.set(
        { agentId: 'a1', service: 'mcp:pmp' },
        {
          kind: 'mcp_oauth',
          service: 'mcp:pmp',
          account: 'pmp',
          scopes: [],
          mcpUrl: 'https://x/y',
          accessToken: 'old',
          refreshToken: 'rfr',
          // 1 min from now → within the 5-min refresh window
          expiresAt: Date.now() + 60_000,
          tokenEndpoint: 'https://auth/token',
          clientId: 'cli',
          createdAt: 0,
        },
      );
      const fetchSpy = vi.fn(async () =>
        new Response(
          JSON.stringify({ access_token: 'new', expires_in: 3600 }),
          { status: 200 },
        ),
      );
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const out = await resolveExternalMcpHeaders(
        {
          x: { type: 'http', url: 'https://x/y', credential_ref: 'mcp:pmp' },
        },
        store,
        { agentId: 'a1' },
      );

      const entry = out.x;
      if (entry && (entry.type === 'http' || entry.type === 'sse')) {
        expect(entry.headers?.Authorization).toBe('Bearer new');
      } else {
        throw new Error('expected http entry');
      }
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      const reread = (await store.get(
        { agentId: 'a1', service: 'mcp:pmp' },
        'test',
      )) as McpOAuthCredential;
      expect(reread.accessToken).toBe('new');
      expect(reread.lastRefreshAt).toBeGreaterThan(0);
    });

    it('does NOT refresh when expiresAt is outside the 5min window', async () => {
      await store.set(
        { agentId: 'a1', service: 'mcp:pmp' },
        {
          kind: 'mcp_oauth',
          service: 'mcp:pmp',
          account: 'pmp',
          scopes: [],
          mcpUrl: 'https://x/y',
          accessToken: 'still_good',
          refreshToken: 'rfr',
          // 1 hour from now → outside the 5-min refresh window
          expiresAt: Date.now() + 60 * 60_000,
          tokenEndpoint: 'https://auth/token',
          clientId: 'cli',
          createdAt: 0,
        },
      );
      const fetchSpy = vi.fn(async () =>
        new Response(JSON.stringify({}), { status: 500 }),
      );
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const out = await resolveExternalMcpHeaders(
        {
          x: { type: 'http', url: 'https://x/y', credential_ref: 'mcp:pmp' },
        },
        store,
        { agentId: 'a1' },
      );

      const entry = out.x;
      if (entry && (entry.type === 'http' || entry.type === 'sse')) {
        expect(entry.headers?.Authorization).toBe('Bearer still_good');
      } else {
        throw new Error('expected http entry');
      }
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('on refresh_revoked: marks credential needs_reauth and omits entry', async () => {
      await store.set(
        { agentId: 'a1', service: 'mcp:pmp' },
        {
          kind: 'mcp_oauth',
          service: 'mcp:pmp',
          account: 'pmp',
          scopes: [],
          mcpUrl: 'https://x/y',
          accessToken: 'old',
          refreshToken: 'rfr',
          expiresAt: Date.now() + 60_000,
          tokenEndpoint: 'https://auth/token',
          clientId: 'cli',
          createdAt: 0,
        },
      );
      const fetchSpy = vi.fn(async () =>
        new Response(JSON.stringify({ error: 'invalid_grant' }), {
          status: 400,
        }),
      );
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const out = await resolveExternalMcpHeaders(
        {
          x: { type: 'http', url: 'https://x/y', credential_ref: 'mcp:pmp' },
        },
        store,
        { agentId: 'a1' },
      );

      expect(out.x).toBeUndefined();
      const reread = (await store.get(
        { agentId: 'a1', service: 'mcp:pmp' },
        'test',
      )) as McpOAuthCredential;
      expect(reread.metadata?.needs_reauth).toBe('1');
      // Access token is untouched on revoke; only needs_reauth flips.
      expect(reread.accessToken).toBe('old');
    });

    it('on generic refresh failure (non-invalid_grant 4xx): omits entry without metadata change', async () => {
      await store.set(
        { agentId: 'a1', service: 'mcp:pmp' },
        {
          kind: 'mcp_oauth',
          service: 'mcp:pmp',
          account: 'pmp',
          scopes: [],
          mcpUrl: 'https://x/y',
          accessToken: 'old',
          refreshToken: 'rfr',
          expiresAt: Date.now() + 60_000,
          tokenEndpoint: 'https://auth/token',
          clientId: 'cli',
          createdAt: 0,
        },
      );
      const fetchSpy = vi.fn(async () =>
        new Response(JSON.stringify({ error: 'server_error' }), {
          status: 500,
        }),
      );
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const out = await resolveExternalMcpHeaders(
        {
          x: { type: 'http', url: 'https://x/y', credential_ref: 'mcp:pmp' },
        },
        store,
        { agentId: 'a1' },
      );

      expect(out.x).toBeUndefined();
      const reread = (await store.get(
        { agentId: 'a1', service: 'mcp:pmp' },
        'test',
      )) as McpOAuthCredential;
      expect(reread.metadata?.needs_reauth).toBeUndefined();
      expect(reread.accessToken).toBe('old');
    });

    it('mcp_apikey: never refreshes regardless of timestamps', async () => {
      await store.set(
        { agentId: 'a1', service: 'mcp:k' },
        {
          kind: 'mcp_apikey',
          service: 'mcp:k',
          account: 'k',
          scopes: [],
          mcpUrl: 'https://x',
          token: 'static',
          scheme: 'Bearer',
          createdAt: 0,
        },
      );
      const fetchSpy = vi.fn(async () =>
        new Response(JSON.stringify({}), { status: 500 }),
      );
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const out = await resolveExternalMcpHeaders(
        { x: { type: 'http', url: 'https://x', credential_ref: 'mcp:k' } },
        store,
        { agentId: 'a1' },
      );

      const entry = out.x;
      if (entry && (entry.type === 'http' || entry.type === 'sse')) {
        expect(entry.headers?.Authorization).toBe('Bearer static');
      } else {
        throw new Error('expected http entry');
      }
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  it('preserves user-supplied non-Authorization headers and overrides Authorization', async () => {
    await store.set(
      { agentId: 'a1', service: 'mcp:k' },
      {
        kind: 'mcp_apikey',
        service: 'mcp:k',
        account: 'k',
        scopes: [],
        mcpUrl: 'https://x',
        token: 'real',
        scheme: 'Bearer',
        createdAt: Date.now(),
      },
    );
    const out = await resolveExternalMcpHeaders(
      {
        s: {
          type: 'http',
          url: 'https://x',
          credential_ref: 'mcp:k',
          headers: { 'X-Trace-Id': 'abc' },
        },
      },
      store,
      { agentId: 'a1' },
    );
    const entry = out.s;
    if (entry && (entry.type === 'http' || entry.type === 'sse')) {
      expect(entry.headers).toEqual({
        'X-Trace-Id': 'abc',
        Authorization: 'Bearer real',
      });
    }
  });
});
