import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EncryptedFilesystemCredentialStore } from '../encrypted-fs-store.js';
import { CredentialAuditLog } from '../audit.js';
import type {
  CredentialStore,
  McpOAuthCredential,
  McpApiKeyCredential,
} from '../index.js';

const KEY = 'b'.repeat(64); // 32 bytes hex

const ORIGINAL_AGENTS_DIR = process.env.OC_AGENTS_DIR;
const ORIGINAL_DATA_DIR = process.env.OC_DATA_DIR;
const ORIGINAL_MASTER_KEY = process.env.ANTHROCLAW_MASTER_KEY;

describe('credential store — MCP variants', () => {
  let dir: string;
  let store: CredentialStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mcp-cred-'));
    process.env.OC_AGENTS_DIR = dir;
    process.env.OC_DATA_DIR = dir;
    process.env.ANTHROCLAW_MASTER_KEY = KEY;
    mkdirSync(join(dir, 'a1'));
    store = new EncryptedFilesystemCredentialStore(new CredentialAuditLog());
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

  it('roundtrips mcp_oauth credential preserving all fields', async () => {
    const cred: McpOAuthCredential = {
      kind: 'mcp_oauth',
      service: 'mcp:postmypost',
      account: 'postmypost',
      scopes: ['read:posts'],
      mcpUrl: 'https://mcp.postmypost.io/mcp',
      accessToken: 'tok_access',
      refreshToken: 'tok_refresh',
      expiresAt: 1_900_000_000_000,
      tokenEndpoint: 'https://auth.postmypost.io/token',
      authorizationServer: 'https://auth.postmypost.io',
      clientId: 'cli_xyz',
      clientSecret: 'sec_xyz',
      createdAt: 1_800_000_000_000,
    };
    await store.set({ agentId: 'a1', service: cred.service }, cred);
    const got = await store.get({ agentId: 'a1', service: cred.service }, 'test');
    expect(got).toEqual(cred);
  });

  it('roundtrips mcp_apikey credential', async () => {
    const cred: McpApiKeyCredential = {
      kind: 'mcp_apikey',
      service: 'mcp:postmypost',
      account: 'postmypost',
      scopes: [],
      mcpUrl: 'https://mcp.postmypost.io/mcp',
      token: 'sk_live_abc',
      scheme: 'Bearer',
      createdAt: 1_800_000_000_000,
    };
    await store.set({ agentId: 'a1', service: cred.service }, cred);
    const got = await store.get({ agentId: 'a1', service: cred.service }, 'test');
    expect(got).toEqual(cred);
  });

  it('legacy credentials without kind field load as oauth', async () => {
    const legacy = {
      service: 'google_calendar',
      account: 'me@example.com',
      accessToken: 'tok',
      scopes: ['cal'],
    };
    await store.set({ agentId: 'a1', service: 'google_calendar' }, legacy as never);
    const got = await store.get({ agentId: 'a1', service: 'google_calendar' }, 'test');
    expect((got as { kind: string }).kind).toBe('oauth');
  });

  it('list() strips every secret-bearing field across all credential variants', async () => {
    // oauth (legacy shape, no kind)
    const oauth = {
      kind: 'oauth' as const,
      service: 'google_calendar',
      account: 'me@example.com',
      accessToken: 'tok_access_oauth',
      refreshToken: 'tok_refresh_oauth',
      scopes: ['cal'],
      expiresAt: 1_800_000_000_000,
    };
    const mcpOauth: McpOAuthCredential = {
      kind: 'mcp_oauth',
      service: 'mcp:postmypost',
      account: 'postmypost',
      scopes: ['read:posts'],
      mcpUrl: 'https://mcp.postmypost.io/mcp',
      accessToken: 'tok_access_mcp',
      refreshToken: 'tok_refresh_mcp',
      expiresAt: 1_900_000_000_000,
      tokenEndpoint: 'https://auth.postmypost.io/token',
      authorizationServer: 'https://auth.postmypost.io',
      clientId: 'cli_xyz',
      clientSecret: 'sec_xyz',
      createdAt: 1_800_000_000_000,
    };
    const mcpApiKey: McpApiKeyCredential = {
      kind: 'mcp_apikey',
      service: 'mcp:other',
      account: 'other',
      scopes: [],
      mcpUrl: 'https://other.example.com/mcp',
      token: 'sk_live_abc',
      scheme: 'Bearer',
      createdAt: 1_800_000_000_000,
    };

    await store.set({ agentId: 'a1', service: oauth.service }, oauth as never);
    await store.set({ agentId: 'a1', service: mcpOauth.service }, mcpOauth);
    await store.set({ agentId: 'a1', service: mcpApiKey.service }, mcpApiKey);

    const list = await store.list('a1');
    expect(list).toHaveLength(3);

    // Every returned object must lack the secret-bearing fields,
    // and must keep the public-safe ones.
    for (const meta of list) {
      const asRecord = meta as unknown as Record<string, unknown>;
      expect(asRecord).not.toHaveProperty('token');
      expect(asRecord).not.toHaveProperty('accessToken');
      expect(asRecord).not.toHaveProperty('refreshToken');
      expect(asRecord).not.toHaveProperty('clientSecret');
      expect(meta).toHaveProperty('service');
      expect(meta).toHaveProperty('account');
      expect(meta).toHaveProperty('scopes');
    }
  });
});
