import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long!!';
process.env.ADMIN_EMAIL = 'admin@test.com';
process.env.ADMIN_PASSWORD = 'testpassword123';

let authShouldFail = false;

vi.mock('@/lib/require-auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/require-auth')>(
    '@/lib/require-auth',
  );
  return {
    ...actual,
    requireAuth: vi.fn(async () => {
      if (authShouldFail) {
        throw new actual.AuthError('unauthorized', 'test-no-auth');
      }
      return { email: 'admin@test.com', authMethod: 'cookie' as const };
    }),
  };
});

const getMock = vi.fn();

vi.mock('@/lib/credential-store-instance', () => ({
  getCredentialStore: () => ({ get: getMock }),
}));

import { GET } from '@/app/api/agents/[agentId]/mcp/[name]/status/route';

beforeEach(() => {
  authShouldFail = false;
  getMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function req(): Request {
  return new Request('http://t/api/agents/a1/mcp/notion/status');
}

function p(agentId: string, name: string) {
  return { params: Promise.resolve({ agentId, name }) };
}

describe('GET /api/agents/[agentId]/mcp/[name]/status', () => {
  it('returns 401 when auth fails', async () => {
    authShouldFail = true;
    const res = await GET(req(), p('a1', 'notion'));
    expect(res.status).toBe(401);
    expect(getMock).not.toHaveBeenCalled();
  });

  it('returns disabled when credential is missing', async () => {
    getMock.mockRejectedValueOnce(new Error('not_found'));
    const res = await GET(req(), p('a1', 'notion'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: 'disabled' });
  });

  it('returns reauth_required when metadata.needs_reauth = 1', async () => {
    getMock.mockResolvedValueOnce({
      kind: 'mcp_oauth',
      service: 'mcp:notion',
      account: 'notion',
      scopes: [],
      mcpUrl: 'https://mcp.notion.com',
      accessToken: 't',
      expiresAt: 1_700_000_000_000,
      createdAt: 1_690_000_000_000,
      metadata: { needs_reauth: '1' },
    });
    const res = await GET(req(), p('a1', 'notion'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: 'reauth_required' });
  });

  it('returns connected with tokenExpiresAt for healthy mcp_oauth', async () => {
    getMock.mockResolvedValueOnce({
      kind: 'mcp_oauth',
      service: 'mcp:notion',
      account: 'notion',
      scopes: [],
      mcpUrl: 'https://mcp.notion.com',
      accessToken: 't',
      expiresAt: 1_700_000_000_000,
      createdAt: 1_690_000_000_000,
    });
    const res = await GET(req(), p('a1', 'notion'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      status: 'connected',
      tokenExpiresAt: 1_700_000_000_000,
    });
  });

  it('returns connected without tokenExpiresAt for mcp_apikey', async () => {
    getMock.mockResolvedValueOnce({
      kind: 'mcp_apikey',
      service: 'mcp:linear',
      account: 'linear',
      scopes: [],
      mcpUrl: 'https://mcp.linear.app/mcp',
      token: 'abc',
      scheme: 'Bearer',
      createdAt: 1_690_000_000_000,
    });
    const res = await GET(req(), p('a1', 'linear'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: 'connected' });
  });

  it('uses correct service key (mcp:<name>) when reading credential', async () => {
    getMock.mockRejectedValueOnce(new Error('not_found'));
    await GET(req(), p('a1', 'postmypost'));
    expect(getMock).toHaveBeenCalledTimes(1);
    const [ref, accessReason] = getMock.mock.calls[0];
    expect(ref).toEqual({ agentId: 'a1', service: 'mcp:postmypost' });
    expect(accessReason).toContain('ui_status_check');
    expect(accessReason).toContain('postmypost');
  });
});
