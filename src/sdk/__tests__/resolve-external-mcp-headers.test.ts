import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveExternalMcpHeaders } from '../external-mcp.js';
import { EncryptedFilesystemCredentialStore } from '../../agent/credentials/encrypted-fs-store.js';
import { CredentialAuditLog } from '../../agent/credentials/audit.js';

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
