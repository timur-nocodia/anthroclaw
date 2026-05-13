import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
  startLogin: vi.fn(),
  completeLogin: vi.fn(),
  cancelLogin: vi.fn(),
  verifyQuery: vi.fn(),
  restartGateway: vi.fn(),
}));

vi.mock('@/lib/route-handler', () => ({
  withAuth: async (handler: () => Promise<Response>) => handler(),
}));

vi.mock('@/lib/claude-auth-instance', () => ({
  getClaudeAuthManager: () => ({
    getStatus: mocks.getStatus,
    startLogin: mocks.startLogin,
    completeLogin: mocks.completeLogin,
    cancelLogin: mocks.cancelLogin,
    verifyQuery: mocks.verifyQuery,
  }),
}));

vi.mock('@/lib/gateway', () => ({
  restartGateway: mocks.restartGateway,
}));

import { GET as statusGET } from '@/app/api/claude-auth/status/route';
import { POST as startPOST } from '@/app/api/claude-auth/start/route';
import { POST as completePOST } from '@/app/api/claude-auth/complete/route';
import { POST as cancelPOST } from '@/app/api/claude-auth/cancel/route';
import { POST as verifyPOST } from '@/app/api/claude-auth/verify/route';
import { POST as restartRuntimePOST } from '@/app/api/claude-auth/restart-runtime/route';

function jsonRequest(body: Record<string, unknown>): Request {
  return new Request('http://test/api/claude-auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
});

describe('Claude auth API routes', () => {
  it('returns sanitized Claude auth status', async () => {
    mocks.getStatus.mockResolvedValueOnce({
      connected: true,
      email: 'operator@example.com',
      runtimeHome: '/home/node',
      credentialFile: { exists: true },
    });

    const res = await statusGET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.connected).toBe(true);
    expect(json.email).toBe('operator@example.com');
    expect(JSON.stringify(json)).not.toContain('sk-ant');
  });

  it('starts the official Claude login flow', async () => {
    mocks.startLogin.mockResolvedValueOnce({
      sessionId: 'auth_1',
      status: 'waiting_for_code',
      loginUrl: 'https://claude.com/cai/oauth/authorize?state=[redacted]',
      safeOutput: 'visit url',
    });

    const res = await startPOST();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.sessionId).toBe('auth_1');
    expect(json.loginUrl).toContain('https://claude.com/cai/oauth/authorize');
  });

  it('completes login, restarts the gateway by default, and never returns the browser code', async () => {
    mocks.completeLogin.mockResolvedValueOnce({
      ok: true,
      sessionId: 'auth_1',
      status: { connected: true },
      safeOutput: 'Authenticated',
      error: null,
    });
    mocks.restartGateway.mockResolvedValueOnce(undefined);

    const res = await completePOST(jsonRequest({
      sessionId: 'auth_1',
      code: 'browser-returned-secret-code',
    }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(mocks.completeLogin).toHaveBeenCalledWith('auth_1', 'browser-returned-secret-code');
    expect(mocks.restartGateway).toHaveBeenCalledTimes(1);
    expect(json.restarted).toBe(true);
    expect(JSON.stringify(json)).not.toContain('browser-returned-secret-code');
  });

  it('does not restart the gateway when completion fails', async () => {
    mocks.completeLogin.mockResolvedValueOnce({
      ok: false,
      sessionId: 'auth_1',
      status: { connected: false },
      safeOutput: 'Invalid code',
      error: 'Invalid code',
    });

    const res = await completePOST(jsonRequest({ sessionId: 'auth_1', code: 'bad-code' }));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.ok).toBe(false);
    expect(mocks.restartGateway).not.toHaveBeenCalled();
  });

  it('cancels a pending auth flow', async () => {
    mocks.cancelLogin.mockReturnValueOnce({ cancelled: true });

    const res = await cancelPOST(jsonRequest({ sessionId: 'auth_1' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.cancelled).toBe(true);
    expect(mocks.cancelLogin).toHaveBeenCalledWith('auth_1');
  });

  it('runs a real Claude verification query', async () => {
    mocks.verifyQuery.mockResolvedValueOnce({
      ok: true,
      checkedAt: '2026-05-13T00:00:00.000Z',
      message: 'Claude runtime accepted a real query.',
      stdoutPreview: 'OK',
    });

    const res = await verifyPOST();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
  });

  it('restarts only the gateway runtime on recovery request', async () => {
    mocks.restartGateway.mockResolvedValueOnce(undefined);

    const res = await restartRuntimePOST();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.restarted).toBe(true);
    expect(mocks.restartGateway).toHaveBeenCalledTimes(1);
  });
});
