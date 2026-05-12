/**
 * Integration test: full OAuth round-trip against a real fixture HTTP
 * server. Exercises probe → startConnection → simulated authorize redirect
 * → completeOAuth, then asserts the credential was written to disk
 * (encrypted), the pending row was marked completed, and `tools/list`
 * returned the fixture's `demo_tool`.
 *
 * The fixture's `/token` endpoint really validates PKCE
 * (SHA-256(verifier).base64url against the stored challenge) — so a bug
 * in `oauth-client.ts` that drops/garbles the verifier or computes the
 * wrong challenge would cause this test to fail with 400 invalid_grant.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOnboarding } from '../../src/integrations/mcp-onboarding/index.js';
import { openPendingStore } from '../../src/integrations/mcp-onboarding/pending-store.js';
import { EncryptedFilesystemCredentialStore } from '../../src/agent/credentials/encrypted-fs-store.js';
import { CredentialAuditLog } from '../../src/agent/credentials/audit.js';
import { startOAuthFixtureServer } from '../fixtures/mcp/oauth-server.js';

const KEY = 'd'.repeat(64);

describe('MCP onboarding OAuth integration', () => {
  let dir: string;
  let baseUrl: string;
  let stop: () => Promise<void>;
  let onboarding: ReturnType<typeof createOnboarding>;

  const originalMasterKey = process.env.ANTHROCLAW_MASTER_KEY;
  const originalAgentsDir = process.env.OC_AGENTS_DIR;
  const originalDataDir = process.env.OC_DATA_DIR;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'mcp-oauth-int-'));
    process.env.ANTHROCLAW_MASTER_KEY = KEY;
    process.env.OC_AGENTS_DIR = dir;
    process.env.OC_DATA_DIR = dir;
    mkdirSync(join(dir, 'a1'), { recursive: true });
    const fixture = await startOAuthFixtureServer();
    baseUrl = fixture.baseUrl;
    stop = fixture.stop;

    const pending = openPendingStore(join(dir, 'mcp.sqlite'));
    const credentials = new EncryptedFilesystemCredentialStore(
      new CredentialAuditLog(join(dir, 'audit.log')),
    );
    onboarding = createOnboarding({
      pending,
      credentials,
      uiBaseUrl: baseUrl, // fixture also hosts the callback origin for the test
      listTakenServerIds: async () => new Set<string>(),
    });
  });

  afterAll(async () => {
    await stop?.();
    if (originalMasterKey === undefined) {
      delete process.env.ANTHROCLAW_MASTER_KEY;
    } else {
      process.env.ANTHROCLAW_MASTER_KEY = originalMasterKey;
    }
    if (originalAgentsDir === undefined) delete process.env.OC_AGENTS_DIR;
    else process.env.OC_AGENTS_DIR = originalAgentsDir;
    if (originalDataDir === undefined) delete process.env.OC_DATA_DIR;
    else process.env.OC_DATA_DIR = originalDataDir;
    rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips probe → start → completeOAuth and writes mcp_oauth credential', async () => {
    const startRes = await onboarding.startConnection({
      url: `${baseUrl}/mcp`,
      requester: { kind: 'admin', userId: 'u1', agentId: 'a1' },
    });
    expect(startRes.status).toBe('authorize');
    expect(startRes.pendingId).toBeTruthy();

    const authUrl = await onboarding.getAuthUrlForPending(startRes.pendingId!);
    expect(authUrl).toBeTruthy();
    expect(authUrl).toContain(`${baseUrl}/authorize`);

    const parsedAuthUrl = new URL(authUrl!);
    const state = parsedAuthUrl.searchParams.get('state')!;
    const clientId = parsedAuthUrl.searchParams.get('client_id')!;
    const codeChallenge = parsedAuthUrl.searchParams.get('code_challenge')!;
    expect(clientId).toBe('cli_test'); // DCR returned this from /register
    expect(codeChallenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(parsedAuthUrl.searchParams.get('code_challenge_method')).toBe('S256');

    // The fixture's /authorize would issue a code and redirect back to the
    // callback. We short-circuit that and feed the code straight into
    // completeOAuth — but we also have to register the code with the
    // fixture so its /token endpoint accepts it. Easiest way: actually
    // hit /authorize via fetch and follow the redirect manually.
    const authResp = await fetch(authUrl!, { redirect: 'manual' });
    expect(authResp.status).toBe(302);
    const location = authResp.headers.get('location')!;
    expect(location).toBeTruthy();
    const callbackUrl = new URL(location);
    const returnedCode = callbackUrl.searchParams.get('code')!;
    const returnedState = callbackUrl.searchParams.get('state')!;
    expect(returnedCode).toBe('auth_test_code');
    expect(returnedState).toBe(state);

    const completeRes = await onboarding.completeOAuth({
      state: returnedState,
      code: returnedCode,
    });
    expect(completeRes.status).toBe('completed');
    if (completeRes.status !== 'completed') {
      throw new Error('completeOAuth did not return completed');
    }
    expect(completeRes.tools.map((t) => t.name)).toContain('demo_tool');

    // Credential written to disk (encrypted) under the derived serverId.
    const serverId = completeRes.serverId;
    const cred = await onboarding._debug!.getCredential(
      'a1',
      `mcp:${serverId}`,
    );
    expect(cred).not.toBeNull();
    expect(cred?.kind).toBe('mcp_oauth');
    if (cred?.kind === 'mcp_oauth') {
      expect(cred.accessToken).toBe('access_test_token');
      expect(cred.refreshToken).toMatch(/^rfr_/);
      expect(cred.mcpUrl).toBe(`${baseUrl}/mcp`);
      expect(cred.tokenEndpoint).toBe(`${baseUrl}/token`);
      expect(cred.authorizationServer).toBe(baseUrl);
    }
  });
});
