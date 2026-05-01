import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// ── Auth bypass ───────────────────────────────────────────────────
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

interface PauseEntry {
  agentId: string;
  peerKey: string;
  pausedAt: string;
  expiresAt: string | null;
  reason: string;
  source: string;
  extendedCount: number;
  lastOperatorMessageAt: string | null;
}

function makeFakeGateway(initial: PauseEntry[] = []) {
  const entries = [...initial];
  return {
    peerPauseStore: {
      list: vi.fn((agentId?: string) =>
        entries.filter((e) => !agentId || e.agentId === agentId),
      ),
      pause: vi.fn(
        (agentId: string, peerKey: string, opts: { ttlMinutes?: number; reason: string; source: string }) => {
          const now = new Date('2026-05-01T00:00:00Z');
          const expiresAt =
            opts.ttlMinutes === undefined
              ? null
              : new Date(now.getTime() + opts.ttlMinutes * 60_000).toISOString();
          const entry: PauseEntry = {
            agentId,
            peerKey,
            pausedAt: now.toISOString(),
            expiresAt,
            reason: opts.reason,
            source: opts.source,
            extendedCount: 0,
            lastOperatorMessageAt: now.toISOString(),
          };
          entries.push(entry);
          return entry;
        },
      ),
      unpause: vi.fn((agentId: string, peerKey: string) => {
        const idx = entries.findIndex(
          (e) => e.agentId === agentId && e.peerKey === peerKey,
        );
        if (idx === -1) return null;
        const [removed] = entries.splice(idx, 1);
        return removed;
      }),
    },
  };
}

function jsonRequest(url: string, body: unknown, method: string): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3000'), {
    method,
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

describe('GET /api/agents/[agentId]/pauses', () => {
  it('returns 401 without auth', async () => {
    authShouldFail = true;
    vi.doMock('@/lib/gateway', () => ({
      getGateway: vi.fn().mockResolvedValue(makeFakeGateway()),
    }));
    const { GET } = await import('@/app/api/agents/[agentId]/pauses/route');
    const req = new NextRequest(new URL('/api/agents/amina/pauses', 'http://localhost'));
    const res = await GET(req, { params: Promise.resolve({ agentId: 'amina' }) });
    expect(res.status).toBe(401);
  });

  it('returns the active pauses for the agent', async () => {
    const gw = makeFakeGateway([
      {
        agentId: 'amina',
        peerKey: 'whatsapp:business:1',
        pausedAt: '2026-05-01T00:00:00Z',
        expiresAt: '2026-05-01T01:00:00Z',
        reason: 'manual',
        source: 'ui',
        extendedCount: 0,
        lastOperatorMessageAt: '2026-05-01T00:00:00Z',
      },
    ]);
    vi.doMock('@/lib/gateway', () => ({ getGateway: vi.fn().mockResolvedValue(gw) }));
    const { GET } = await import('@/app/api/agents/[agentId]/pauses/route');
    const req = new NextRequest(new URL('/api/agents/amina/pauses', 'http://localhost'));
    const res = await GET(req, { params: Promise.resolve({ agentId: 'amina' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pauses).toHaveLength(1);
    expect(body.pauses[0].peerKey).toBe('whatsapp:business:1');
    expect(gw.peerPauseStore.list).toHaveBeenCalledWith('amina');
  });

  it('returns empty list when peerPauseStore is null', async () => {
    vi.doMock('@/lib/gateway', () => ({
      getGateway: vi.fn().mockResolvedValue({ peerPauseStore: null }),
    }));
    const { GET } = await import('@/app/api/agents/[agentId]/pauses/route');
    const req = new NextRequest(new URL('/api/agents/amina/pauses', 'http://localhost'));
    const res = await GET(req, { params: Promise.resolve({ agentId: 'amina' }) });
    const body = await res.json();
    expect(body.pauses).toEqual([]);
  });
});

describe('POST /api/agents/[agentId]/pauses', () => {
  it('creates a TTL pause and returns the entry', async () => {
    const gw = makeFakeGateway();
    vi.doMock('@/lib/gateway', () => ({ getGateway: vi.fn().mockResolvedValue(gw) }));
    const { POST } = await import('@/app/api/agents/[agentId]/pauses/route');
    const req = jsonRequest(
      '/api/agents/amina/pauses',
      { channel: 'whatsapp', account_id: 'business', peer_id: '37120@s.whatsapp.net', ttl_minutes: 60 },
      'POST',
    );
    const res = await POST(req, { params: Promise.resolve({ agentId: 'amina' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.pause.peerKey).toBe('whatsapp:business:37120@s.whatsapp.net');
    expect(body.pause.reason).toBe('manual');
    expect(gw.peerPauseStore.pause).toHaveBeenCalled();
  });

  it('creates an indefinite pause when ttl_minutes is null', async () => {
    const gw = makeFakeGateway();
    vi.doMock('@/lib/gateway', () => ({ getGateway: vi.fn().mockResolvedValue(gw) }));
    const { POST } = await import('@/app/api/agents/[agentId]/pauses/route');
    const req = jsonRequest(
      '/api/agents/amina/pauses',
      { channel: 'whatsapp', account_id: 'business', peer_id: '1', ttl_minutes: null },
      'POST',
    );
    const res = await POST(req, { params: Promise.resolve({ agentId: 'amina' }) });
    const body = await res.json();
    expect(body.pause.reason).toBe('manual_indefinite');
    expect(body.pause.expiresAt).toBeNull();
  });

  it('rejects body without channel/peer_id or peer_key', async () => {
    const gw = makeFakeGateway();
    vi.doMock('@/lib/gateway', () => ({ getGateway: vi.fn().mockResolvedValue(gw) }));
    const { POST } = await import('@/app/api/agents/[agentId]/pauses/route');
    const req = jsonRequest('/api/agents/amina/pauses', {}, 'POST');
    const res = await POST(req, { params: Promise.resolve({ agentId: 'amina' }) });
    expect(res.status).toBe(400);
  });

  it('returns 401 without auth', async () => {
    authShouldFail = true;
    vi.doMock('@/lib/gateway', () => ({
      getGateway: vi.fn().mockResolvedValue(makeFakeGateway()),
    }));
    const { POST } = await import('@/app/api/agents/[agentId]/pauses/route');
    const req = jsonRequest(
      '/api/agents/amina/pauses',
      { peer_key: 'x', ttl_minutes: 5 },
      'POST',
    );
    const res = await POST(req, { params: Promise.resolve({ agentId: 'amina' }) });
    expect(res.status).toBe(401);
  });
});

describe('DELETE /api/agents/[agentId]/pauses/[peerKey]', () => {
  it('unpauses the entry and reports was_paused=true', async () => {
    const gw = makeFakeGateway([
      {
        agentId: 'amina',
        peerKey: 'whatsapp:business:1',
        pausedAt: '2026-05-01T00:00:00Z',
        expiresAt: null,
        reason: 'manual',
        source: 'ui',
        extendedCount: 0,
        lastOperatorMessageAt: null,
      },
    ]);
    vi.doMock('@/lib/gateway', () => ({ getGateway: vi.fn().mockResolvedValue(gw) }));
    const { DELETE } = await import('@/app/api/agents/[agentId]/pauses/[peerKey]/route');
    const req = new NextRequest(
      new URL('/api/agents/amina/pauses/whatsapp%3Abusiness%3A1', 'http://localhost'),
      { method: 'DELETE' },
    );
    const res = await DELETE(req, {
      params: Promise.resolve({ agentId: 'amina', peerKey: 'whatsapp:business:1' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.was_paused).toBe(true);
    expect(gw.peerPauseStore.unpause).toHaveBeenCalledWith(
      'amina',
      'whatsapp:business:1',
      'ui:unpause',
    );
  });

  it('reports was_paused=false when no entry existed', async () => {
    const gw = makeFakeGateway();
    vi.doMock('@/lib/gateway', () => ({ getGateway: vi.fn().mockResolvedValue(gw) }));
    const { DELETE } = await import('@/app/api/agents/[agentId]/pauses/[peerKey]/route');
    const req = new NextRequest(
      new URL('/api/agents/amina/pauses/x', 'http://localhost'),
      { method: 'DELETE' },
    );
    const res = await DELETE(req, {
      params: Promise.resolve({ agentId: 'amina', peerKey: 'x' }),
    });
    const body = await res.json();
    expect(body.was_paused).toBe(false);
  });

  it('returns 401 without auth', async () => {
    authShouldFail = true;
    vi.doMock('@/lib/gateway', () => ({
      getGateway: vi.fn().mockResolvedValue(makeFakeGateway()),
    }));
    const { DELETE } = await import('@/app/api/agents/[agentId]/pauses/[peerKey]/route');
    const req = new NextRequest(
      new URL('/api/agents/amina/pauses/x', 'http://localhost'),
      { method: 'DELETE' },
    );
    const res = await DELETE(req, {
      params: Promise.resolve({ agentId: 'amina', peerKey: 'x' }),
    });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/agents/[agentId]/pause-events', () => {
  it('synthesises a timeline from current pauses (v1)', async () => {
    const gw = makeFakeGateway([
      {
        agentId: 'amina',
        peerKey: 'whatsapp:business:1',
        pausedAt: '2026-05-01T00:00:00Z',
        expiresAt: '2026-05-01T01:00:00Z',
        reason: 'manual',
        source: 'ui',
        extendedCount: 0,
        lastOperatorMessageAt: null,
      },
    ]);
    vi.doMock('@/lib/gateway', () => ({ getGateway: vi.fn().mockResolvedValue(gw) }));
    const { GET } = await import('@/app/api/agents/[agentId]/pause-events/route');
    const req = new NextRequest(
      new URL('/api/agents/amina/pause-events', 'http://localhost'),
    );
    const res = await GET(req, { params: Promise.resolve({ agentId: 'amina' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.events).toHaveLength(1);
    expect(body.events[0].kind).toBe('pause_started');
    expect(body.events[0].peerKey).toBe('whatsapp:business:1');
  });
});
