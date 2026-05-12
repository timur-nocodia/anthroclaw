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

  it('rejects oauth requests with chatType != private from agents', async () => {
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

  it('returns authorize URL for oauth probe (Phase 4 fills the dance)', async () => {
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
    expect(res.status).toBe('authorize');
    expect(res.authUrl).toMatch(
      /^https:\/\/ui\.test\/api\/mcp\/oauth\/start\/[^/]+$/,
    );
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

    const cred = await onboarding._debug.getCredential('a1', 'mcp:postmypost');
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
    });

    await ob.finalize({
      pendingId: started.pendingId!,
      allowed_tools: ['*'],
    });
    expect(writer.mock.calls[0][0].entry.allowed_tools).toEqual(['t1', 't2']);
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
    });
    await expect(
      ob.finalize({ pendingId: started.pendingId!, allowed_tools: [] }),
    ).rejects.toThrow(/pending_not_ready/);
  });
});
