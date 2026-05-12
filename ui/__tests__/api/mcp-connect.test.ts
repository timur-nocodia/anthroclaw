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

const startConnectionMock = vi.fn();
const attachApiKeyMock = vi.fn();
const finalizeMock = vi.fn();

vi.mock('@/lib/mcp-onboarding-instance', () => ({
  getOnboarding: () => ({
    startConnection: startConnectionMock,
    attachApiKey: attachApiKeyMock,
    finalize: finalizeMock,
  }),
}));

import { POST as startPOST } from '@/app/api/mcp/connect/start/route';
import { POST as apikeyPOST } from '@/app/api/mcp/connect/apikey/route';
import { POST as finalizePOST } from '@/app/api/mcp/connect/finalize/route';

beforeEach(() => {
  authShouldFail = false;
  startConnectionMock.mockReset();
  attachApiKeyMock.mockReset();
  finalizeMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonReq(url: string, body: unknown): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/mcp/connect/start', () => {
  it('returns 401 when auth fails', async () => {
    authShouldFail = true;
    const res = await startPOST(
      jsonReq('http://t/api/mcp/connect/start', {
        url: 'https://mcp.x.io/mcp',
        agentId: 'a1',
      }),
    );
    expect(res.status).toBe(401);
  });

  it('returns 400 on invalid body', async () => {
    const res = await startPOST(
      jsonReq('http://t/api/mcp/connect/start', { agentId: 'a1' }),
    );
    expect(res.status).toBe(400);
    expect(startConnectionMock).not.toHaveBeenCalled();
  });

  it('forwards request to onboarding.startConnection with admin requester', async () => {
    startConnectionMock.mockResolvedValueOnce({
      status: 'awaiting_apikey',
      pendingId: 'pnd_x',
      apikeyUrl: 'https://ui.test/mcp/connect/pnd_x/apikey',
    });
    const res = await startPOST(
      jsonReq('http://t/api/mcp/connect/start', {
        url: 'https://mcp.x.io/mcp',
        agentId: 'a1',
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('awaiting_apikey');
    expect(startConnectionMock).toHaveBeenCalledWith({
      url: 'https://mcp.x.io/mcp',
      requester: {
        kind: 'admin',
        userId: 'admin@test.com',
        agentId: 'a1',
      },
    });
  });
});

describe('POST /api/mcp/connect/apikey', () => {
  it('does NOT require admin auth (secret pendingId is the boundary)', async () => {
    authShouldFail = true;
    attachApiKeyMock.mockResolvedValueOnce({
      status: 'connected',
      tools: [],
    });
    const res = await apikeyPOST(
      jsonReq('http://t/api/mcp/connect/apikey', {
        pendingId: 'pnd_x',
        token: 'sk_live_xxx',
      }),
    );
    expect(res.status).toBe(200);
    expect(attachApiKeyMock).toHaveBeenCalled();
  });

  it('returns 400 on missing pendingId', async () => {
    const res = await apikeyPOST(
      jsonReq('http://t/api/mcp/connect/apikey', { token: 'x' }),
    );
    expect(res.status).toBe(400);
    expect(attachApiKeyMock).not.toHaveBeenCalled();
  });

  it('forwards invalid_token result from facade', async () => {
    attachApiKeyMock.mockResolvedValueOnce({ status: 'invalid_token' });
    const res = await apikeyPOST(
      jsonReq('http://t/api/mcp/connect/apikey', {
        pendingId: 'pnd_x',
        token: 'bad',
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('invalid_token');
  });
});

describe('POST /api/mcp/connect/finalize', () => {
  it('returns 401 when auth fails', async () => {
    authShouldFail = true;
    const res = await finalizePOST(
      jsonReq('http://t/api/mcp/connect/finalize', {
        pendingId: 'pnd_x',
        allowed_tools: [],
      }),
    );
    expect(res.status).toBe(401);
  });

  it('returns 400 on invalid body', async () => {
    const res = await finalizePOST(
      jsonReq('http://t/api/mcp/connect/finalize', {
        pendingId: 'pnd_x',
        allowed_tools: 'not-an-array',
      }),
    );
    expect(res.status).toBe(400);
    expect(finalizeMock).not.toHaveBeenCalled();
  });

  it('forwards finalize result', async () => {
    finalizeMock.mockResolvedValueOnce({
      status: 'connected',
      server: 'postmypost',
      tools: [{ name: 'post_create' }],
    });
    const res = await finalizePOST(
      jsonReq('http://t/api/mcp/connect/finalize', {
        pendingId: 'pnd_x',
        allowed_tools: ['post_create'],
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.server).toBe('postmypost');
    expect(finalizeMock).toHaveBeenCalledWith({
      pendingId: 'pnd_x',
      allowed_tools: ['post_create'],
    });
  });

  it('returns 400 when facade throws (pending_not_ready)', async () => {
    finalizeMock.mockRejectedValueOnce(new Error('pending_not_ready'));
    const res = await finalizePOST(
      jsonReq('http://t/api/mcp/connect/finalize', {
        pendingId: 'pnd_x',
        allowed_tools: [],
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('pending_not_ready');
  });
});
