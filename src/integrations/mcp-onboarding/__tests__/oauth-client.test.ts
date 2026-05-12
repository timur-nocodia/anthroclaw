import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildAuthorizationUrl,
  exchangeCode,
  generatePkce,
  refreshToken,
  registerClient,
} from '../oauth-client.js';

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
      ((fetchStub.mock.calls as unknown as Array<[unknown, RequestInit]>)[0]![1]).body as string,
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

describe('buildAuthorizationUrl', () => {
  it('encodes all OAuth 2.1 params', () => {
    const url = buildAuthorizationUrl({
      authorizationEndpoint: 'https://auth/authorize',
      clientId: 'cli',
      redirectUri: 'https://ui/cb',
      state: 'st_x',
      codeChallenge: 'ch_x',
      scopes: ['read', 'write'],
    });
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://auth/authorize');
    expect(parsed.searchParams.get('client_id')).toBe('cli');
    expect(parsed.searchParams.get('redirect_uri')).toBe('https://ui/cb');
    expect(parsed.searchParams.get('state')).toBe('st_x');
    expect(parsed.searchParams.get('code_challenge')).toBe('ch_x');
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('scope')).toBe('read write');
  });

  it('omits scope when no scopes given', () => {
    const url = buildAuthorizationUrl({
      authorizationEndpoint: 'https://auth/authorize',
      clientId: 'cli',
      redirectUri: 'https://ui/cb',
      state: 'st',
      codeChallenge: 'ch',
    });
    expect(new URL(url).searchParams.has('scope')).toBe(false);
  });
});

describe('exchangeCode', () => {
  it('POSTs urlencoded auth-code grant + PKCE verifier and returns tokens', async () => {
    const fetchStub = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            access_token: 'tok',
            refresh_token: 'rfr',
            expires_in: 3600,
            scope: 'read write',
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchStub);
    const before = Date.now();
    const r = await exchangeCode({
      tokenEndpoint: 'https://auth/token',
      clientId: 'cli',
      clientSecret: 'sec',
      redirectUri: 'https://ui/cb',
      code: 'auth_code',
      codeVerifier: 'verifier',
    });
    expect(r.accessToken).toBe('tok');
    expect(r.refreshToken).toBe('rfr');
    expect(r.scopes).toEqual(['read', 'write']);
    expect(r.expiresAt!).toBeGreaterThanOrEqual(before + 3600 * 1000 - 50);
    const init = (fetchStub.mock.calls as unknown as Array<[unknown, RequestInit]>)[0]![1];
    expect((init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/x-www-form-urlencoded',
    );
    const parsed = new URLSearchParams(
      (init.body as URLSearchParams).toString(),
    );
    expect(parsed.get('grant_type')).toBe('authorization_code');
    expect(parsed.get('code')).toBe('auth_code');
    expect(parsed.get('redirect_uri')).toBe('https://ui/cb');
    expect(parsed.get('client_id')).toBe('cli');
    expect(parsed.get('code_verifier')).toBe('verifier');
    expect(parsed.get('client_secret')).toBe('sec');
  });

  it('omits client_secret when not given', async () => {
    const fetchStub = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ access_token: 'tok' }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchStub);
    await exchangeCode({
      tokenEndpoint: 'https://auth/token',
      clientId: 'cli',
      redirectUri: 'https://ui/cb',
      code: 'c',
      codeVerifier: 'v',
    });
    const parsed = new URLSearchParams(
      ((fetchStub.mock.calls as unknown as Array<[unknown, RequestInit]>)[0]![1]).body as URLSearchParams,
    );
    expect(parsed.get('client_secret')).toBeNull();
  });

  it('throws token_exchange_failed on non-2xx', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 401 })),
    );
    await expect(
      exchangeCode({
        tokenEndpoint: 'https://auth/token',
        clientId: 'cli',
        redirectUri: 'https://ui/cb',
        code: 'c',
        codeVerifier: 'v',
      }),
    ).rejects.toThrow(/token_exchange_failed/);
  });
});

describe('insecure-endpoint warning', () => {
  it('warns when exchangeCode is called with http:// in production', async () => {
    const originalEnv = process.env.NODE_ENV;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      process.env.NODE_ENV = 'production';
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () =>
            new Response(JSON.stringify({ access_token: 'tok' }), {
              status: 200,
            }),
        ),
      );
      await exchangeCode({
        tokenEndpoint: 'http://evil.example.com/token',
        clientId: 'cli',
        redirectUri: 'https://ui/cb',
        code: 'c',
        codeVerifier: 'v',
      });
      expect(warnSpy).toHaveBeenCalled();
      const joined = warnSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(joined).toMatch(/insecure|HTTPS/i);
      expect(joined).toContain('http://evil.example.com/token');
    } finally {
      process.env.NODE_ENV = originalEnv;
      warnSpy.mockRestore();
    }
  });

  it('does NOT warn for http://localhost endpoints in production', async () => {
    const originalEnv = process.env.NODE_ENV;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      process.env.NODE_ENV = 'production';
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () =>
            new Response(JSON.stringify({ access_token: 'tok' }), {
              status: 200,
            }),
        ),
      );
      await exchangeCode({
        tokenEndpoint: 'http://localhost:1234/token',
        clientId: 'cli',
        redirectUri: 'https://ui/cb',
        code: 'c',
        codeVerifier: 'v',
      });
      const insecureCalls = warnSpy.mock.calls.filter((c) =>
        String(c[0]).includes('insecure'),
      );
      expect(insecureCalls).toHaveLength(0);
    } finally {
      process.env.NODE_ENV = originalEnv;
      warnSpy.mockRestore();
    }
  });

  it('does NOT warn outside production even for http:// endpoints', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // NODE_ENV is 'test' under vitest — leave it alone.
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () =>
            new Response(JSON.stringify({ access_token: 'tok' }), {
              status: 200,
            }),
        ),
      );
      await exchangeCode({
        tokenEndpoint: 'http://evil2.example.com/token',
        clientId: 'cli',
        redirectUri: 'https://ui/cb',
        code: 'c',
        codeVerifier: 'v',
      });
      const insecureCalls = warnSpy.mock.calls.filter((c) =>
        String(c[0]).includes('insecure'),
      );
      expect(insecureCalls).toHaveLength(0);
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('refreshToken', () => {
  it('POSTs refresh_token grant and returns new tokens', async () => {
    const fetchStub = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ access_token: 'new', expires_in: 3600 }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchStub);
    const r = await refreshToken({
      tokenEndpoint: 'https://auth/token',
      clientId: 'cli',
      refreshToken: 'rfr',
    });
    expect(r.accessToken).toBe('new');
    const parsed = new URLSearchParams(
      ((fetchStub.mock.calls as unknown as Array<[unknown, RequestInit]>)[0]![1]).body as URLSearchParams,
    );
    expect(parsed.get('grant_type')).toBe('refresh_token');
    expect(parsed.get('refresh_token')).toBe('rfr');
    expect(parsed.get('client_id')).toBe('cli');
  });

  it('throws refresh_revoked on 400 + invalid_grant', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: 'invalid_grant' }), {
            status: 400,
          }),
      ),
    );
    await expect(
      refreshToken({
        tokenEndpoint: 'https://auth/token',
        clientId: 'cli',
        refreshToken: 'rfr',
      }),
    ).rejects.toThrow(/refresh_revoked/);
  });

  it('throws refresh_failed on other 4xx', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 500 })),
    );
    await expect(
      refreshToken({
        tokenEndpoint: 'https://auth/token',
        clientId: 'cli',
        refreshToken: 'rfr',
      }),
    ).rejects.toThrow(/refresh_failed/);
  });
});
