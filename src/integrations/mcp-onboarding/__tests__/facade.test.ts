import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOnboarding } from '../index.js';
import { openPendingStore, type PendingStore } from '../pending-store.js';
import { EncryptedFilesystemCredentialStore } from '../../../agent/credentials/encrypted-fs-store.js';
import { CredentialAuditLog } from '../../../agent/credentials/audit.js';

const probeStub = vi.fn();

vi.mock('../probe.js', () => ({
  probe: (...args: unknown[]) => probeStub(...args),
}));

const KEY = 'c'.repeat(64);
const ORIGINAL_AGENTS_DIR = process.env.OC_AGENTS_DIR;
const ORIGINAL_DATA_DIR = process.env.OC_DATA_DIR;
const ORIGINAL_MASTER_KEY = process.env.ANTHROCLAW_MASTER_KEY;

describe('onboarding facade — apikey branch', () => {
  let dir: string;
  let pending: PendingStore;
  let onboarding: ReturnType<typeof createOnboarding>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mcp-fac-'));
    process.env.OC_AGENTS_DIR = dir;
    process.env.OC_DATA_DIR = dir;
    process.env.ANTHROCLAW_MASTER_KEY = KEY;
    mkdirSync(join(dir, 'a1'));
    const credentials = new EncryptedFilesystemCredentialStore(
      new CredentialAuditLog(join(dir, 'audit.log')),
    );
    pending = openPendingStore(join(dir, 'mcp.sqlite'));
    onboarding = createOnboarding({
      pending,
      credentials,
      uiBaseUrl: 'https://ui.test',
      listTakenServerIds: async () => new Set<string>(),
    });
    probeStub.mockReset();
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

  it('apikey probe → pending row + apikeyUrl', async () => {
    probeStub.mockResolvedValueOnce({
      authMode: 'apikey',
      server: { name: 'pmp' },
    });
    const res = await onboarding.startConnection({
      url: 'https://mcp.postmypost.io/mcp',
      requester: { kind: 'admin', userId: 'u1', agentId: 'a1' },
    });
    expect(res.status).toBe('awaiting_apikey');
    expect(res.apikeyUrl).toMatch(
      /^https:\/\/ui\.test\/mcp\/connect\/[^/]+\/apikey$/,
    );
    expect(res.pendingId).toBeTruthy();
    expect(res.serverName).toBe('pmp');

    // Pending row persisted with apikey mode and pending status.
    const row = pending.byId(res.pendingId!);
    expect(row?.authMode).toBe('apikey');
    expect(row?.status).toBe('pending');
    expect(row?.agentId).toBe('a1');
  });

  it('rejects oauth requests with chatType=group from agents', async () => {
    probeStub.mockResolvedValueOnce({
      authMode: 'apikey',
      server: { name: 'pmp' },
    });
    const res = await onboarding.startConnection({
      url: 'https://mcp.postmypost.io/mcp',
      requester: {
        kind: 'agent',
        agentId: 'a1',
        chatType: 'group',
      },
    });
    expect(res.status).toBe('rejected');
    expect(res.reason).toBe('mcp_onboarding_requires_dm');
    expect(probeStub).not.toHaveBeenCalled();
  });

  it('rejects oauth requests with chatType=supergroup from agents', async () => {
    probeStub.mockResolvedValueOnce({
      authMode: 'apikey',
      server: { name: 'pmp' },
    });
    const res = await onboarding.startConnection({
      url: 'https://mcp.postmypost.io/mcp',
      requester: {
        kind: 'agent',
        agentId: 'a1',
        chatType: 'supergroup',
      },
    });
    expect(res.status).toBe('rejected');
    expect(res.reason).toBe('mcp_onboarding_requires_dm');
    expect(probeStub).not.toHaveBeenCalled();
  });

  it('rejects oauth requests with chatType=channel from agents', async () => {
    probeStub.mockResolvedValueOnce({
      authMode: 'apikey',
      server: { name: 'pmp' },
    });
    const res = await onboarding.startConnection({
      url: 'https://mcp.postmypost.io/mcp',
      requester: {
        kind: 'agent',
        agentId: 'a1',
        chatType: 'channel',
      },
    });
    expect(res.status).toBe('rejected');
    expect(res.reason).toBe('mcp_onboarding_requires_dm');
    expect(probeStub).not.toHaveBeenCalled();
  });

  it('startConnection rejects authMode=none with helpful reason', async () => {
    probeStub.mockResolvedValueOnce({
      authMode: 'none',
      server: { name: 'open' },
    });
    const res = await onboarding.startConnection({
      url: 'https://mcp.open/y',
      requester: { kind: 'admin', userId: 'u1', agentId: 'a1' },
    });
    expect(res.status).toBe('rejected');
    expect(res.reason).toBe('no_auth_servers_not_yet_supported');
  });

  it('rejects with reason when probe returns manual', async () => {
    probeStub.mockResolvedValueOnce({
      authMode: 'manual',
      reason: 'non_bearer_scheme',
    });
    const res = await onboarding.startConnection({
      url: 'https://x/y',
      requester: { kind: 'admin', userId: 'u1', agentId: 'a1' },
    });
    expect(res.status).toBe('rejected');
    expect(res.reason).toBe('non_bearer_scheme');
  });

  it('returns authorize URL for oauth probe with DCR registration', async () => {
    probeStub.mockResolvedValueOnce({
      authMode: 'oauth',
      server: { name: 'x' },
      oauth: {
        issuer: 'https://auth/',
        authorizationEndpoint: 'https://auth/authorize',
        tokenEndpoint: 'https://auth/token',
        registrationEndpoint: 'https://auth/register',
        scopesSupported: ['read'],
        resource: 'https://mcp.x/y',
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              client_id: 'cli_x',
              client_secret: 'sec_x',
            }),
            { status: 201 },
          ),
      ),
    );
    const res = await onboarding.startConnection({
      url: 'https://mcp.x/y',
      requester: { kind: 'admin', userId: 'u1', agentId: 'a1' },
    });
    expect(res.status).toBe('authorize');
    expect(res.authUrl).toMatch(
      /^https:\/\/ui\.test\/api\/mcp\/oauth\/start\/[^/]+$/,
    );
    const row = pending.byId(res.pendingId!);
    expect(row?.authMode).toBe('oauth');
    expect(row?.clientId).toBe('cli_x');
    expect(row?.clientSecret).toBe('sec_x');
    expect(row?.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(row?.oauthMetadata).toBeTruthy();
  });

  it('rejects oauth probe when no registration_endpoint AND no staticClientId', async () => {
    probeStub.mockResolvedValueOnce({
      authMode: 'oauth',
      server: { name: 'x' },
      oauth: {
        issuer: 'https://auth/',
        authorizationEndpoint: 'https://auth/authorize',
        tokenEndpoint: 'https://auth/token',
        resource: 'https://mcp.x/y',
      },
    });
    const res = await onboarding.startConnection({
      url: 'https://mcp.x/y',
      requester: { kind: 'admin', userId: 'u1', agentId: 'a1' },
    });
    expect(res.status).toBe('rejected');
    expect(res.reason).toBe('dcr_required_but_not_supported');
  });

  it('uses staticClientId when no registration_endpoint', async () => {
    const credentials = new EncryptedFilesystemCredentialStore(
      new CredentialAuditLog(join(dir, 'audit.log')),
    );
    const ob = createOnboarding({
      pending,
      credentials,
      uiBaseUrl: 'https://ui.test',
      listTakenServerIds: async () => new Set<string>(),
      staticClientId: 'static_cli',
    });
    probeStub.mockResolvedValueOnce({
      authMode: 'oauth',
      server: { name: 'x' },
      oauth: {
        issuer: 'https://auth/',
        authorizationEndpoint: 'https://auth/authorize',
        tokenEndpoint: 'https://auth/token',
        resource: 'https://mcp.x/y',
      },
    });
    const res = await ob.startConnection({
      url: 'https://mcp.x/y',
      requester: { kind: 'admin', userId: 'u1', agentId: 'a1' },
    });
    expect(res.status).toBe('authorize');
    const row = pending.byId(res.pendingId!);
    expect(row?.clientId).toBe('static_cli');
    expect(row?.clientSecret).toBeNull();
  });

  it('getAuthUrlForPending returns null for unknown id', async () => {
    expect(await onboarding.getAuthUrlForPending('pnd_nope')).toBeNull();
  });

  it('getAuthUrlForPending logs and returns null when oauth_metadata is corrupt', async () => {
    pending.insert({
      id: 'pnd_corrupt',
      state: 'st_corrupt',
      agentId: 'a1',
      agentSessionKey: null,
      mcpUrl: 'https://mcp.x/y',
      authMode: 'oauth',
      codeVerifier: 'verifier_xyz',
      clientId: 'cli_x',
      clientSecret: null,
      oauthMetadata: 'not-json',
      toolsMetadata: null,
      requestedBy: 'admin:u1',
      status: 'pending',
      failureReason: null,
      createdAt: Date.now(),
      expiresAt: Date.now() + 600_000,
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const url = await onboarding.getAuthUrlForPending('pnd_corrupt');
    expect(url).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
    const firstArg = warnSpy.mock.calls[0]?.[0];
    expect(String(firstArg)).toMatch(/oauth_metadata|getAuthUrlForPending/i);
    warnSpy.mockRestore();
  });

  it('getAuthUrlForPending returns null for expired pending', async () => {
    const fixedNow = 5_000_000;
    const ob = createOnboarding({
      pending,
      credentials: new EncryptedFilesystemCredentialStore(
        new CredentialAuditLog(join(dir, 'audit.log')),
      ),
      uiBaseUrl: 'https://ui.test',
      listTakenServerIds: async () => new Set<string>(),
      now: () => fixedNow,
    });
    pending.insert({
      id: 'pnd_expired_oauth',
      state: 'st_expired_oauth',
      agentId: 'a1',
      agentSessionKey: null,
      mcpUrl: 'https://mcp.x/y',
      authMode: 'oauth',
      codeVerifier: 'verifier_xyz',
      clientId: 'cli_x',
      clientSecret: null,
      oauthMetadata: JSON.stringify({
        issuer: 'https://auth/',
        authorizationEndpoint: 'https://auth/authorize',
        tokenEndpoint: 'https://auth/token',
        resource: 'https://mcp.x/y',
      }),
      toolsMetadata: null,
      requestedBy: 'admin:u1',
      status: 'pending',
      failureReason: null,
      createdAt: fixedNow - 10_000,
      expiresAt: fixedNow - 1,
    });
    expect(await ob.getAuthUrlForPending('pnd_expired_oauth')).toBeNull();
  });

  it('getAuthUrlForPending rebuilds URL with re-derived PKCE challenge', async () => {
    const { createHash } = await import('node:crypto');
    const verifier = 'a'.repeat(43);
    const expectedChallenge = createHash('sha256')
      .update(verifier)
      .digest('base64url');
    pending.insert({
      id: 'pnd_rebuild',
      state: 'st_rebuild_xyz',
      agentId: 'a1',
      agentSessionKey: null,
      mcpUrl: 'https://mcp.x/y',
      authMode: 'oauth',
      codeVerifier: verifier,
      clientId: 'cli_x',
      clientSecret: null,
      oauthMetadata: JSON.stringify({
        issuer: 'https://auth/',
        authorizationEndpoint: 'https://auth/authorize',
        tokenEndpoint: 'https://auth/token',
        scopesSupported: ['read', 'write'],
        resource: 'https://mcp.x/y',
      }),
      toolsMetadata: null,
      requestedBy: 'admin:u1',
      status: 'pending',
      failureReason: null,
      createdAt: Date.now(),
      expiresAt: Date.now() + 600_000,
    });
    const url = await onboarding.getAuthUrlForPending('pnd_rebuild');
    expect(url).toBeTruthy();
    const parsed = new URL(url!);
    expect(parsed.origin + parsed.pathname).toBe('https://auth/authorize');
    expect(parsed.searchParams.get('client_id')).toBe('cli_x');
    expect(parsed.searchParams.get('state')).toBe('st_rebuild_xyz');
    expect(parsed.searchParams.get('code_challenge')).toBe(expectedChallenge);
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
    expect(parsed.searchParams.get('redirect_uri')).toBe(
      'https://ui.test/api/mcp/oauth/callback',
    );
    expect(parsed.searchParams.get('scope')).toBe('read write');
  });

  it('completeOAuth happy path: writes credential, marks completed, returns tools', async () => {
    pending.insert({
      id: 'pnd_oauth',
      state: 'st_oauth_happy',
      agentId: 'a1',
      agentSessionKey: null,
      mcpUrl: 'https://mcp.x/y',
      authMode: 'oauth',
      codeVerifier: 'verifier_abc',
      clientId: 'cli_x',
      clientSecret: 'sec_x',
      oauthMetadata: JSON.stringify({
        issuer: 'https://auth/',
        authorizationEndpoint: 'https://auth/authorize',
        tokenEndpoint: 'https://auth/token',
        resource: 'https://mcp.x/y',
      }),
      toolsMetadata: null,
      requestedBy: 'admin:u1',
      status: 'pending',
      failureReason: null,
      createdAt: Date.now(),
      expiresAt: Date.now() + 600_000,
    });

    const fetchStub = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === 'https://auth/token') {
        return new Response(
          JSON.stringify({
            access_token: 'tok_x',
            refresh_token: 'rfr_x',
            expires_in: 3600,
            scope: 'read',
          }),
          { status: 200 },
        );
      }
      if (url === 'https://mcp.x/y') {
        const body = JSON.parse((init?.body as string) ?? '{}');
        if (body.method === 'tools/list') {
          return new Response(
            JSON.stringify({
              result: { tools: [{ name: 'list_things' }] },
            }),
            { status: 200 },
          );
        }
      }
      throw new Error('unexpected fetch ' + url);
    });
    vi.stubGlobal('fetch', fetchStub);

    const res = await onboarding.completeOAuth({
      state: 'st_oauth_happy',
      code: 'auth_code_x',
    });
    expect(res.status).toBe('completed');
    if (res.status === 'completed') {
      expect(res.tools.map((t) => t.name)).toEqual(['list_things']);
      expect(res.serverId).toBeTruthy();
    }
    const cred = await onboarding._debug?.getCredential('a1', 'mcp:x');
    expect(cred?.kind).toBe('mcp_oauth');
    const row = pending.byId('pnd_oauth');
    expect(row?.status).toBe('completed');
    expect(row?.toolsMetadata).toBeTruthy();
  });

  it('completeOAuth returns gone for unknown state (replayed)', async () => {
    const res = await onboarding.completeOAuth({
      state: 'st_nope',
      code: 'c',
    });
    expect(res.status).toBe('gone');
  });

  it('completeOAuth returns gone and marks failed when expired', async () => {
    const fixedNow = 7_000_000;
    const ob = createOnboarding({
      pending,
      credentials: new EncryptedFilesystemCredentialStore(
        new CredentialAuditLog(join(dir, 'audit.log')),
      ),
      uiBaseUrl: 'https://ui.test',
      listTakenServerIds: async () => new Set<string>(),
      now: () => fixedNow,
    });
    pending.insert({
      id: 'pnd_oauth_exp',
      state: 'st_oauth_exp',
      agentId: 'a1',
      agentSessionKey: null,
      mcpUrl: 'https://mcp.x/y',
      authMode: 'oauth',
      codeVerifier: 'v',
      clientId: 'cli_x',
      clientSecret: null,
      oauthMetadata: JSON.stringify({
        issuer: 'https://auth/',
        authorizationEndpoint: 'https://auth/authorize',
        tokenEndpoint: 'https://auth/token',
        resource: 'https://mcp.x/y',
      }),
      toolsMetadata: null,
      requestedBy: 'admin:u1',
      status: 'pending',
      failureReason: null,
      createdAt: fixedNow - 1000,
      expiresAt: fixedNow - 100,
    });
    const res = await ob.completeOAuth({
      state: 'st_oauth_exp',
      code: 'c',
    });
    expect(res.status).toBe('gone');
    const row = pending.byId('pnd_oauth_exp');
    expect(row?.status).toBe('failed');
    expect(row?.failureReason).toBe('expired');
  });

  it('cancelByState transitions a pending row to cancelled', async () => {
    pending.insert({
      id: 'pnd_cancel',
      state: 'st_cancel',
      agentId: 'a1',
      agentSessionKey: null,
      mcpUrl: 'https://mcp.x/y',
      authMode: 'oauth',
      codeVerifier: 'v',
      clientId: 'cli_x',
      clientSecret: null,
      oauthMetadata: JSON.stringify({
        issuer: 'https://auth/',
        authorizationEndpoint: 'https://auth/authorize',
        tokenEndpoint: 'https://auth/token',
        resource: 'https://mcp.x/y',
      }),
      toolsMetadata: null,
      requestedBy: 'admin:u1',
      status: 'pending',
      failureReason: null,
      createdAt: Date.now(),
      expiresAt: Date.now() + 600_000,
    });
    const ok = await onboarding.cancelByState('st_cancel', 'access_denied');
    expect(ok).toBe(true);
    const row = pending.byId('pnd_cancel');
    expect(row?.status).toBe('cancelled');
    expect(row?.failureReason).toBe('access_denied');

    // Second call is a no-op (state already consumed).
    const second = await onboarding.cancelByState('st_cancel', 'access_denied');
    expect(second).toBe(false);
  });

  it('cancelByState returns false for unknown state', async () => {
    expect(await onboarding.cancelByState('st_unknown', 'x')).toBe(false);
  });

  it('cancel returns not_found for unknown pendingId', () => {
    expect(onboarding.cancel('pnd_unknown')).toEqual({ status: 'not_found' });
  });

  it('cancel returns cancelled for pending row and marks it cancelled', () => {
    pending.insert({
      id: 'pnd_can_pending',
      state: 'st_can_pending',
      agentId: 'a1',
      agentSessionKey: null,
      mcpUrl: 'https://mcp.x/y',
      authMode: 'oauth',
      codeVerifier: 'v',
      clientId: 'cli',
      clientSecret: null,
      oauthMetadata: null,
      toolsMetadata: null,
      requestedBy: 'admin:u1',
      status: 'pending',
      failureReason: null,
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    });
    expect(onboarding.cancel('pnd_can_pending')).toEqual({ status: 'cancelled' });
    const row = pending.byId('pnd_can_pending');
    expect(row?.status).toBe('cancelled');
    expect(row?.failureReason).toBe('user_cancelled');
  });

  it('cancel returns not_cancellable for already-completed row', () => {
    pending.insert({
      id: 'pnd_can_done',
      state: 'st_can_done',
      agentId: 'a1',
      agentSessionKey: null,
      mcpUrl: 'https://mcp.x/y',
      authMode: 'oauth',
      codeVerifier: 'v',
      clientId: 'cli',
      clientSecret: null,
      oauthMetadata: null,
      toolsMetadata: null,
      requestedBy: 'admin:u1',
      status: 'completed',
      failureReason: null,
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    });
    expect(onboarding.cancel('pnd_can_done')).toEqual({ status: 'not_cancellable' });
    const row = pending.byId('pnd_can_done');
    expect(row?.status).toBe('completed');
  });

  it('cancel returns not_cancellable for already-failed row', () => {
    pending.insert({
      id: 'pnd_can_failed',
      state: 'st_can_failed',
      agentId: 'a1',
      agentSessionKey: null,
      mcpUrl: 'https://mcp.x/y',
      authMode: 'oauth',
      codeVerifier: 'v',
      clientId: 'cli',
      clientSecret: null,
      oauthMetadata: null,
      toolsMetadata: null,
      requestedBy: 'admin:u1',
      status: 'failed',
      failureReason: 'boom',
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    });
    expect(onboarding.cancel('pnd_can_failed')).toEqual({ status: 'not_cancellable' });
    const row = pending.byId('pnd_can_failed');
    expect(row?.status).toBe('failed');
    expect(row?.failureReason).toBe('boom');
  });

  it('attachApiKey writes credential + returns discovered tools', async () => {
    probeStub.mockResolvedValueOnce({
      authMode: 'apikey',
      server: { name: 'pmp' },
    });
    const started = await onboarding.startConnection({
      url: 'https://mcp.postmypost.io/mcp',
      requester: { kind: 'admin', userId: 'u1', agentId: 'a1' },
    });

    const fetchStub = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse((init?.body as string) ?? '{}');
      if (body.method === 'initialize') {
        return new Response(
          JSON.stringify({ result: { serverInfo: { name: 'pmp' } } }),
          { status: 200 },
        );
      }
      if (body.method === 'tools/list') {
        return new Response(
          JSON.stringify({
            result: {
              tools: [
                { name: 'post_create', description: 'd', inputSchema: {} },
              ],
            },
          }),
          { status: 200 },
        );
      }
      throw new Error('unexpected ' + body.method);
    });
    vi.stubGlobal('fetch', fetchStub);

    const res = await onboarding.attachApiKey({
      pendingId: started.pendingId!,
      token: 'sk_live_xxx',
    });
    expect(res.status).toBe('connected');
    expect(res.tools?.map((t) => t.name)).toEqual(['post_create']);

    const cred = await onboarding._debug?.getCredential('a1', 'mcp:postmypost');
    expect(cred?.kind).toBe('mcp_apikey');

    // Pending row should now be marked completed with toolsMetadata.
    const row = pending.byId(started.pendingId!);
    expect(row?.status).toBe('completed');
    expect(row?.toolsMetadata).toBeTruthy();
  });

  it('attachApiKey returns invalid_token on 401', async () => {
    probeStub.mockResolvedValueOnce({
      authMode: 'apikey',
      server: { name: 'pmp' },
    });
    const started = await onboarding.startConnection({
      url: 'https://mcp.postmypost.io/mcp',
      requester: { kind: 'admin', userId: 'u1', agentId: 'a1' },
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('Unauthorized', { status: 401 })),
    );

    const res = await onboarding.attachApiKey({
      pendingId: started.pendingId!,
      token: 'bad_key',
    });
    expect(res.status).toBe('invalid_token');
  });

  it('attachApiKey on unknown pendingId returns invalid_token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 200 })),
    );
    const res = await onboarding.attachApiKey({
      pendingId: 'pnd_nope',
      token: 'x',
    });
    expect(res.status).toBe('invalid_token');
  });

  it('finalize writes external_mcp_servers entry via injected writer', async () => {
    probeStub.mockResolvedValueOnce({
      authMode: 'apikey',
      server: { name: 'pmp' },
    });
    const started = await onboarding.startConnection({
      url: 'https://mcp.postmypost.io/mcp',
      requester: { kind: 'admin', userId: 'u1', agentId: 'a1' },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u, init) => {
        const body = JSON.parse((init?.body as string) ?? '{}');
        if (body.method === 'initialize') return new Response('{}', { status: 200 });
        return new Response(
          JSON.stringify({
            result: { tools: [{ name: 'post_create' }, { name: 'post_delete' }] },
          }),
          { status: 200 },
        );
      }),
    );
    await onboarding.attachApiKey({
      pendingId: started.pendingId!,
      token: 'sk_x',
    });

    const writer = vi.fn();
    const credentials = new EncryptedFilesystemCredentialStore(
      new CredentialAuditLog(join(dir, 'audit.log')),
    );
    const ob = createOnboarding({
      pending,
      credentials,
      uiBaseUrl: 'https://ui.test',
      writeAgentYml: writer,
      listTakenServerIds: async () => new Set<string>(),
    });

    const res = await ob.finalize({
      pendingId: started.pendingId!,
      allowed_tools: ['post_create'],
    });
    expect(res.status).toBe('connected');
    expect(res.server).toBe('postmypost');
    expect(writer).toHaveBeenCalledWith({
      agentId: 'a1',
      key: 'postmypost',
      entry: {
        type: 'http',
        url: 'https://mcp.postmypost.io/mcp',
        display_name: 'postmypost',
        credential_ref: 'mcp:postmypost',
        allowed_tools: ['post_create'],
      },
    });
  });

  it("finalize expands allowed_tools=['*'] to discovered tool names", async () => {
    probeStub.mockResolvedValueOnce({
      authMode: 'apikey',
      server: { name: 'pmp' },
    });
    const started = await onboarding.startConnection({
      url: 'https://mcp.postmypost.io/mcp',
      requester: { kind: 'admin', userId: 'u1', agentId: 'a1' },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u, init) => {
        const body = JSON.parse((init?.body as string) ?? '{}');
        if (body.method === 'initialize') return new Response('{}', { status: 200 });
        return new Response(
          JSON.stringify({
            result: { tools: [{ name: 't1' }, { name: 't2' }] },
          }),
          { status: 200 },
        );
      }),
    );
    await onboarding.attachApiKey({
      pendingId: started.pendingId!,
      token: 'sk_x',
    });

    const writer = vi.fn();
    const credentials = new EncryptedFilesystemCredentialStore(
      new CredentialAuditLog(join(dir, 'audit.log')),
    );
    const ob = createOnboarding({
      pending,
      credentials,
      uiBaseUrl: 'https://ui.test',
      writeAgentYml: writer,
      listTakenServerIds: async () => new Set<string>(),
    });

    await ob.finalize({
      pendingId: started.pendingId!,
      allowed_tools: ['*'],
    });
    expect(writer.mock.calls[0][0].entry.allowed_tools).toEqual(['t1', 't2']);
  });

  it('_debug helper is exposed under NODE_ENV=test and gated to null otherwise', async () => {
    // Sanity: vitest sets NODE_ENV=test, so the existing facade exposes _debug.
    expect(process.env.NODE_ENV).toBe('test');
    expect(onboarding._debug).not.toBeNull();
    expect(typeof onboarding._debug?.getCredential).toBe('function');

    // Now temporarily flip NODE_ENV and build a fresh facade: _debug must be
    // null so production callers can't contaminate the audit log with
    // accessReason='test_debug'.
    const originalEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      const prodOb = createOnboarding({
        pending,
        credentials: new EncryptedFilesystemCredentialStore(
          new CredentialAuditLog(join(dir, 'audit.log')),
        ),
        uiBaseUrl: 'https://ui.test',
        listTakenServerIds: async () => new Set<string>(),
      });
      expect(prodOb._debug).toBeNull();
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it('uses listTakenServerIds to avoid colliding credential overwrites', async () => {
    // Inject a "taken set" that already contains the hostname-derived id, so
    // attachApiKey must store the credential under `mcp:postmypost-2`.
    const credentials = new EncryptedFilesystemCredentialStore(
      new CredentialAuditLog(join(dir, 'audit.log')),
    );
    const ob = createOnboarding({
      pending,
      credentials,
      uiBaseUrl: 'https://ui.test',
      listTakenServerIds: async () => new Set(['postmypost']),
    });
    probeStub.mockResolvedValueOnce({
      authMode: 'apikey',
      server: { name: 'pmp' },
    });
    const started = await ob.startConnection({
      url: 'https://mcp.postmypost.io/mcp',
      requester: { kind: 'admin', userId: 'u1', agentId: 'a1' },
    });
    // mcpUrl preserved in the pending row.
    const row = pending.byId(started.pendingId!);
    expect(row?.mcpUrl).toBe('https://mcp.postmypost.io/mcp');

    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u, init) => {
        const body = JSON.parse((init?.body as string) ?? '{}');
        if (body.method === 'initialize') {
          return new Response('{}', { status: 200 });
        }
        return new Response(
          JSON.stringify({ result: { tools: [{ name: 't1' }] } }),
          { status: 200 },
        );
      }),
    );
    const att = await ob.attachApiKey({
      pendingId: started.pendingId!,
      token: 'sk_x',
    });
    expect(att.status).toBe('connected');
    expect(att.serverId).toBe('postmypost-2');

    // Credential persisted under mcp:postmypost-2, NOT mcp:postmypost.
    const cred = await ob._debug?.getCredential('a1', 'mcp:postmypost-2');
    expect(cred?.kind).toBe('mcp_apikey');
    const wrong = await ob._debug?.getCredential('a1', 'mcp:postmypost');
    expect(wrong).toBeNull();
  });

  it('attachApiKey rejects an expired pending row', async () => {
    // Insert a pending row directly with expiresAt in the past.
    const fixedNow = 1_000_000;
    const ob = createOnboarding({
      pending,
      credentials: new EncryptedFilesystemCredentialStore(
        new CredentialAuditLog(join(dir, 'audit.log')),
      ),
      uiBaseUrl: 'https://ui.test',
      listTakenServerIds: async () => new Set<string>(),
      now: () => fixedNow,
    });
    pending.insert({
      id: 'pnd_expired',
      state: 'st_expired',
      agentId: 'a1',
      agentSessionKey: null,
      mcpUrl: 'https://mcp.x/y',
      authMode: 'apikey',
      codeVerifier: null,
      clientId: null,
      clientSecret: null,
      oauthMetadata: null,
      toolsMetadata: null,
      requestedBy: 'admin:u1',
      status: 'pending',
      failureReason: null,
      createdAt: fixedNow - 2000,
      expiresAt: fixedNow - 1000,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 200 })),
    );
    const res = await ob.attachApiKey({
      pendingId: 'pnd_expired',
      token: 'sk_x',
    });
    expect(res.status).toBe('invalid_token');
    const row = pending.byId('pnd_expired');
    expect(row?.status).toBe('failed');
    expect(row?.failureReason).toBe('expired');
  });

  it('finalize throws when pending row has expired', async () => {
    const fixedNow = 2_000_000;
    const writer = vi.fn();
    const ob = createOnboarding({
      pending,
      credentials: new EncryptedFilesystemCredentialStore(
        new CredentialAuditLog(join(dir, 'audit.log')),
      ),
      uiBaseUrl: 'https://ui.test',
      writeAgentYml: writer,
      listTakenServerIds: async () => new Set<string>(),
      now: () => fixedNow,
    });
    pending.insert({
      id: 'pnd_expired_done',
      state: 'st_expired_done',
      agentId: 'a1',
      agentSessionKey: null,
      mcpUrl: 'https://mcp.x/y',
      authMode: 'apikey',
      codeVerifier: null,
      clientId: null,
      clientSecret: null,
      oauthMetadata: null,
      toolsMetadata: JSON.stringify({
        serverId: 'x',
        tools: [{ name: 't1' }],
      }),
      requestedBy: 'admin:u1',
      status: 'completed',
      failureReason: null,
      createdAt: fixedNow - 2000,
      expiresAt: fixedNow - 1000,
    });
    await expect(
      ob.finalize({ pendingId: 'pnd_expired_done', allowed_tools: ['*'] }),
    ).rejects.toThrow(/pending_expired/);
    expect(writer).not.toHaveBeenCalled();
  });

  it('finalize throws if pending is not yet completed', async () => {
    probeStub.mockResolvedValueOnce({
      authMode: 'apikey',
      server: { name: 'pmp' },
    });
    const started = await onboarding.startConnection({
      url: 'https://mcp.postmypost.io/mcp',
      requester: { kind: 'admin', userId: 'u1', agentId: 'a1' },
    });
    const writer = vi.fn();
    const credentials = new EncryptedFilesystemCredentialStore(
      new CredentialAuditLog(join(dir, 'audit.log')),
    );
    const ob = createOnboarding({
      pending,
      credentials,
      uiBaseUrl: 'https://ui.test',
      writeAgentYml: writer,
      listTakenServerIds: async () => new Set<string>(),
    });
    await expect(
      ob.finalize({ pendingId: started.pendingId!, allowed_tools: [] }),
    ).rejects.toThrow(/pending_not_ready/);
  });
});
