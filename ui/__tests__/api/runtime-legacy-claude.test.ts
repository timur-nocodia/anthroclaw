import { describe, expect, it, vi } from 'vitest';

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

import { GET as statusGET } from '@/app/api/runtime/legacy/claude/status/route';
import { POST as startPOST } from '@/app/api/runtime/legacy/claude/start/route';
import { POST as restartPOST } from '@/app/api/runtime/legacy/claude/restart-runtime/route';

describe('runtime legacy Claude API aliases', () => {
  it('exposes legacy fallback status through the runtime namespace', async () => {
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
    expect(json.legacyRuntime).toBe(true);
    expect(json.runtimeRole).toBe('legacy-fallback');
    expect(json.provider).toBe('claude-agent-sdk');
  });

  it('keeps login and restart aliases under the same legacy fallback contract', async () => {
    mocks.startLogin.mockResolvedValueOnce({
      sessionId: 'auth_1',
      status: 'waiting_for_code',
      loginUrl: 'https://claude.com/cai/oauth/authorize?state=[redacted]',
      safeOutput: 'visit url',
    });
    mocks.restartGateway.mockResolvedValueOnce(undefined);

    const start = await startPOST();
    const startJson = await start.json();
    const restart = await restartPOST();
    const restartJson = await restart.json();

    expect(startJson.legacyRuntime).toBe(true);
    expect(startJson.runtimeRole).toBe('legacy-fallback');
    expect(restartJson.legacyRuntime).toBe(true);
    expect(restartJson.runtimeRole).toBe('legacy-fallback');
  });
});
