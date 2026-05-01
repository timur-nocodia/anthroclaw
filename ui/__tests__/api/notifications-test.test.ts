import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

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

function makeFakeGateway(opts: { withEmitter?: boolean } = {}) {
  if (opts.withEmitter === false) {
    return { notificationsEmitter: null };
  }
  return {
    notificationsEmitter: {
      emit: vi.fn(async () => undefined),
    },
  };
}

function jsonRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3000'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  authShouldFail = false;
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('POST /api/notifications/test', () => {
  it('dispatches a notification through the emitter (default event escalation_needed)', async () => {
    const gw = makeFakeGateway();
    vi.doMock('@/lib/gateway', () => ({ getGateway: vi.fn().mockResolvedValue(gw) }));
    const { POST } = await import('@/app/api/notifications/test/route');
    const req = jsonRequest('/api/notifications/test', {
      agentId: 'amina',
      message: 'hello operator',
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.event).toBe('escalation_needed');
    expect(gw.notificationsEmitter!.emit).toHaveBeenCalledOnce();
    const [event, payload] = gw.notificationsEmitter!.emit.mock.calls[0];
    expect(event).toBe('escalation_needed');
    expect(payload.agentId).toBe('amina');
    expect(payload.message).toBe('hello operator');
    expect(payload.test).toBe(true);
  });

  it('honours an explicit known event', async () => {
    const gw = makeFakeGateway();
    vi.doMock('@/lib/gateway', () => ({ getGateway: vi.fn().mockResolvedValue(gw) }));
    const { POST } = await import('@/app/api/notifications/test/route');
    const req = jsonRequest('/api/notifications/test', {
      agentId: 'amina',
      event: 'peer_pause_started',
    });
    const res = await POST(req);
    const body = await res.json();
    expect(body.event).toBe('peer_pause_started');
  });

  it('falls back to escalation_needed for unknown events', async () => {
    const gw = makeFakeGateway();
    vi.doMock('@/lib/gateway', () => ({ getGateway: vi.fn().mockResolvedValue(gw) }));
    const { POST } = await import('@/app/api/notifications/test/route');
    const req = jsonRequest('/api/notifications/test', {
      agentId: 'amina',
      event: 'totally_unknown',
    });
    const res = await POST(req);
    const body = await res.json();
    expect(body.event).toBe('escalation_needed');
  });

  it('rejects body without agentId', async () => {
    const gw = makeFakeGateway();
    vi.doMock('@/lib/gateway', () => ({ getGateway: vi.fn().mockResolvedValue(gw) }));
    const { POST } = await import('@/app/api/notifications/test/route');
    const req = jsonRequest('/api/notifications/test', {});
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 503 when notifications emitter is missing', async () => {
    vi.doMock('@/lib/gateway', () => ({
      getGateway: vi.fn().mockResolvedValue({ notificationsEmitter: null }),
    }));
    const { POST } = await import('@/app/api/notifications/test/route');
    const req = jsonRequest('/api/notifications/test', { agentId: 'amina' });
    const res = await POST(req);
    expect(res.status).toBe(503);
  });

  it('returns 401 without auth', async () => {
    authShouldFail = true;
    vi.doMock('@/lib/gateway', () => ({
      getGateway: vi.fn().mockResolvedValue(makeFakeGateway()),
    }));
    const { POST } = await import('@/app/api/notifications/test/route');
    const req = jsonRequest('/api/notifications/test', { agentId: 'amina' });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});
