import { afterEach, describe, expect, it, vi } from 'vitest';
import { generatePkce, registerClient } from '../oauth-client.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('generatePkce', () => {
  it('returns 43-char URL-safe verifier and SHA-256 challenge', () => {
    const { verifier, challenge, method } = generatePkce();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(method).toBe('S256');
    expect(verifier).not.toBe(challenge);
  });

  it('is deterministic when seeded', () => {
    const seed = Buffer.alloc(32, 7);
    const a = generatePkce(seed);
    const b = generatePkce(seed);
    expect(a).toEqual(b);
  });
});

describe('registerClient', () => {
  it('POSTs RFC 7591 body and returns clientId/clientSecret', async () => {
    const fetchStub = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ client_id: 'cli_x', client_secret: 'sec_x' }),
          { status: 201 },
        ),
    );
    vi.stubGlobal('fetch', fetchStub);
    const r = await registerClient({
      registrationEndpoint: 'https://auth/register',
      redirectUri: 'https://ui/api/mcp/oauth/callback',
      clientName: 'AnthroClaw',
      scopes: ['read', 'write'],
    });
    expect(r.clientId).toBe('cli_x');
    expect(r.clientSecret).toBe('sec_x');
    const sentBody = JSON.parse(
      (fetchStub.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(sentBody).toMatchObject({
      redirect_uris: ['https://ui/api/mcp/oauth/callback'],
      client_name: 'AnthroClaw',
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      scope: 'read write',
    });
  });

  it('omits client_secret when AS issues none (public client)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ client_id: 'cli_public' }), {
            status: 201,
          }),
      ),
    );
    const r = await registerClient({
      registrationEndpoint: 'https://auth/register',
      redirectUri: 'https://ui/cb',
      clientName: 'AnthroClaw',
    });
    expect(r.clientId).toBe('cli_public');
    expect(r.clientSecret).toBeUndefined();
  });

  it('throws dcr_failed on non-2xx', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 400 })),
    );
    await expect(
      registerClient({
        registrationEndpoint: 'https://auth/register',
        redirectUri: 'https://ui/cb',
        clientName: 'AnthroClaw',
      }),
    ).rejects.toThrow(/dcr_failed/);
  });

  it('throws dcr_failed when endpoint is malformed', async () => {
    await expect(
      registerClient({
        registrationEndpoint: 'not a url',
        redirectUri: 'https://ui/cb',
        clientName: 'AnthroClaw',
      }),
    ).rejects.toThrow(/dcr_failed/);
  });
});
