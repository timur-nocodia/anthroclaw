import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long!!';
process.env.ADMIN_EMAIL = 'admin@test.com';
process.env.ADMIN_PASSWORD = 'testpassword123';

const getAuthUrlForPendingMock = vi.fn();
const completeOAuthMock = vi.fn();
const cancelByStateMock = vi.fn();

vi.mock('@/lib/mcp-onboarding-instance', () => ({
  getOnboarding: () => ({
    getAuthUrlForPending: getAuthUrlForPendingMock,
    completeOAuth: completeOAuthMock,
    cancelByState: cancelByStateMock,
  }),
}));

import { GET as startGET } from '@/app/api/mcp/oauth/start/[pendingId]/route';
import { GET as callbackGET } from '@/app/api/mcp/oauth/callback/route';

beforeEach(() => {
  getAuthUrlForPendingMock.mockReset();
  completeOAuthMock.mockReset();
  cancelByStateMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GET /api/mcp/oauth/start/[pendingId]', () => {
  it('redirects 302 to the rebuilt auth URL', async () => {
    getAuthUrlForPendingMock.mockResolvedValueOnce(
      'https://auth.test/authorize?client_id=cli&state=st_x',
    );
    const res = await startGET(
      new Request('http://t/api/mcp/oauth/start/pnd_x'),
      { params: Promise.resolve({ pendingId: 'pnd_x' }) },
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(
      'https://auth.test/authorize?client_id=cli&state=st_x',
    );
    expect(getAuthUrlForPendingMock).toHaveBeenCalledWith('pnd_x');
  });

  it('returns 410 when pending is unknown / expired', async () => {
    getAuthUrlForPendingMock.mockResolvedValueOnce(null);
    const res = await startGET(
      new Request('http://t/api/mcp/oauth/start/pnd_nope'),
      { params: Promise.resolve({ pendingId: 'pnd_nope' }) },
    );
    expect(res.status).toBe(410);
  });
});

describe('GET /api/mcp/oauth/callback', () => {
  it('returns 400 when state is missing', async () => {
    const res = await callbackGET(
      new Request('http://t/api/mcp/oauth/callback?code=c'),
    );
    expect(res.status).toBe(400);
    expect(completeOAuthMock).not.toHaveBeenCalled();
  });

  it('returns 400 when code is missing (and no error)', async () => {
    const res = await callbackGET(
      new Request('http://t/api/mcp/oauth/callback?state=st_x'),
    );
    expect(res.status).toBe(400);
    expect(completeOAuthMock).not.toHaveBeenCalled();
  });

  it('redirects to /mcp/cancelled when provider returned ?error', async () => {
    cancelByStateMock.mockResolvedValueOnce(true);
    const res = await callbackGET(
      new Request(
        'http://t/api/mcp/oauth/callback?state=st_x&error=access_denied',
      ),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(
      'http://t/mcp/cancelled?reason=access_denied',
    );
    expect(cancelByStateMock).toHaveBeenCalledWith('st_x', 'access_denied');
    expect(completeOAuthMock).not.toHaveBeenCalled();
  });

  it('returns 410 on gone (replayed state)', async () => {
    completeOAuthMock.mockResolvedValueOnce({ status: 'gone' });
    const res = await callbackGET(
      new Request('http://t/api/mcp/oauth/callback?state=st_x&code=c'),
    );
    expect(res.status).toBe(410);
  });

  it('redirects to /mcp/failed on failure', async () => {
    completeOAuthMock.mockResolvedValueOnce({
      status: 'failed',
      reason: 'token_exchange_failed: 400',
    });
    const res = await callbackGET(
      new Request('http://t/api/mcp/oauth/callback?state=st_x&code=c'),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(
      `http://t/mcp/failed?reason=${encodeURIComponent(
        'token_exchange_failed: 400',
      )}`,
    );
  });

  it('redirects agent-initiated flows to /mcp/done', async () => {
    completeOAuthMock.mockResolvedValueOnce({
      status: 'completed',
      pendingId: 'pnd_x',
      serverId: 'srv',
      tools: [],
      row: {
        id: 'pnd_x',
        agentId: 'a1',
        requestedBy: 'agent:session_42',
      },
    });
    const res = await callbackGET(
      new Request('http://t/api/mcp/oauth/callback?state=st_x&code=c'),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('http://t/mcp/done');
  });

  it('redirects admin-initiated flows to the wizard step 3', async () => {
    completeOAuthMock.mockResolvedValueOnce({
      status: 'completed',
      pendingId: 'pnd_xyz',
      serverId: 'srv',
      tools: [],
      row: {
        id: 'pnd_xyz',
        agentId: 'agent_a1',
        requestedBy: 'admin:admin@test.com',
      },
    });
    const res = await callbackGET(
      new Request('http://t/api/mcp/oauth/callback?state=st_x&code=c'),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(
      'http://t/fleet/_local/agents/agent_a1?mcpWizard=tools&pendingId=pnd_xyz',
    );
  });
});
