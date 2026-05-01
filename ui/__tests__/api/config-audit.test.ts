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

interface PersistedEntry {
  ts: string;
  callerAgent: string;
  callerSession?: string;
  targetAgent: string;
  section: 'notifications' | 'human_takeover' | 'operator_console';
  action: string;
  prev: unknown;
  new: unknown;
  source: 'chat' | 'ui' | 'system';
}

function makeFakeGateway(allEntries: Record<string, PersistedEntry[]>) {
  return {
    getConfigAuditLog: () => ({
      append: vi.fn(),
      readRecent: vi.fn(
        async (
          agentId: string,
          opts?: { limit?: number; section?: PersistedEntry['section'] },
        ): Promise<PersistedEntry[]> => {
          const entries = allEntries[agentId] ?? [];
          const filtered = opts?.section
            ? entries.filter((e) => e.section === opts.section)
            : entries.slice();
          // newest-first
          filtered.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
          const limit = opts?.limit ?? 50;
          return filtered.slice(0, limit);
        },
      ),
    }),
  };
}

beforeEach(() => {
  authShouldFail = false;
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('GET /api/agents/[agentId]/config-audit', () => {
  it('returns 401 without auth', async () => {
    authShouldFail = true;
    vi.doMock('@/lib/gateway', () => ({
      getGateway: vi.fn().mockResolvedValue(makeFakeGateway({})),
    }));
    const { GET } = await import('@/app/api/agents/[agentId]/config-audit/route');
    const req = new NextRequest(
      new URL('/api/agents/klavdia/config-audit', 'http://localhost'),
    );
    const res = await GET(req, { params: Promise.resolve({ agentId: 'klavdia' }) });
    expect(res.status).toBe(401);
  });

  it('returns entries newest-first', async () => {
    const gw = makeFakeGateway({
      klavdia: [
        {
          ts: '2026-05-01T10:00:00.000Z',
          callerAgent: 'klavdia',
          targetAgent: 'klavdia',
          section: 'notifications',
          action: 'notifications.set_enabled',
          prev: { enabled: false },
          new: { enabled: true },
          source: 'chat',
        },
        {
          ts: '2026-05-01T11:00:00.000Z',
          callerAgent: 'ui',
          targetAgent: 'klavdia',
          section: 'human_takeover',
          action: 'ui_save_human_takeover',
          prev: { enabled: false },
          new: { enabled: true },
          source: 'ui',
        },
      ],
    });
    vi.doMock('@/lib/gateway', () => ({ getGateway: vi.fn().mockResolvedValue(gw) }));
    const { GET } = await import('@/app/api/agents/[agentId]/config-audit/route');
    const req = new NextRequest(
      new URL('/api/agents/klavdia/config-audit', 'http://localhost'),
    );
    const res = await GET(req, { params: Promise.resolve({ agentId: 'klavdia' }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: PersistedEntry[] };
    expect(body.entries).toHaveLength(2);
    expect(body.entries[0].ts).toBe('2026-05-01T11:00:00.000Z');
    expect(body.entries[1].ts).toBe('2026-05-01T10:00:00.000Z');
  });

  it('respects the limit query param', async () => {
    const gw = makeFakeGateway({
      klavdia: [
        {
          ts: '2026-05-01T10:00:00.000Z',
          callerAgent: 'klavdia',
          targetAgent: 'klavdia',
          section: 'notifications',
          action: 'notifications.set_enabled',
          prev: null,
          new: null,
          source: 'chat',
        },
        {
          ts: '2026-05-01T11:00:00.000Z',
          callerAgent: 'klavdia',
          targetAgent: 'klavdia',
          section: 'human_takeover',
          action: 'human_takeover.set_enabled',
          prev: null,
          new: null,
          source: 'chat',
        },
        {
          ts: '2026-05-01T12:00:00.000Z',
          callerAgent: 'klavdia',
          targetAgent: 'klavdia',
          section: 'operator_console',
          action: 'operator_console.update',
          prev: null,
          new: null,
          source: 'chat',
        },
      ],
    });
    vi.doMock('@/lib/gateway', () => ({ getGateway: vi.fn().mockResolvedValue(gw) }));
    const { GET } = await import('@/app/api/agents/[agentId]/config-audit/route');
    const req = new NextRequest(
      new URL('/api/agents/klavdia/config-audit?limit=1', 'http://localhost'),
    );
    const res = await GET(req, { params: Promise.resolve({ agentId: 'klavdia' }) });
    const body = (await res.json()) as { entries: PersistedEntry[] };
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].ts).toBe('2026-05-01T12:00:00.000Z');
  });

  it('filters by section query param', async () => {
    const gw = makeFakeGateway({
      klavdia: [
        {
          ts: '2026-05-01T10:00:00.000Z',
          callerAgent: 'klavdia',
          targetAgent: 'klavdia',
          section: 'notifications',
          action: 'notifications.set_enabled',
          prev: null,
          new: null,
          source: 'chat',
        },
        {
          ts: '2026-05-01T11:00:00.000Z',
          callerAgent: 'klavdia',
          targetAgent: 'klavdia',
          section: 'human_takeover',
          action: 'human_takeover.set_enabled',
          prev: null,
          new: null,
          source: 'chat',
        },
      ],
    });
    vi.doMock('@/lib/gateway', () => ({ getGateway: vi.fn().mockResolvedValue(gw) }));
    const { GET } = await import('@/app/api/agents/[agentId]/config-audit/route');
    const req = new NextRequest(
      new URL(
        '/api/agents/klavdia/config-audit?section=notifications',
        'http://localhost',
      ),
    );
    const res = await GET(req, { params: Promise.resolve({ agentId: 'klavdia' }) });
    const body = (await res.json()) as { entries: PersistedEntry[] };
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].section).toBe('notifications');
  });

  it('ignores unknown section values (returns all entries)', async () => {
    const gw = makeFakeGateway({
      klavdia: [
        {
          ts: '2026-05-01T10:00:00.000Z',
          callerAgent: 'klavdia',
          targetAgent: 'klavdia',
          section: 'notifications',
          action: 'notifications.set_enabled',
          prev: null,
          new: null,
          source: 'chat',
        },
      ],
    });
    vi.doMock('@/lib/gateway', () => ({ getGateway: vi.fn().mockResolvedValue(gw) }));
    const { GET } = await import('@/app/api/agents/[agentId]/config-audit/route');
    const req = new NextRequest(
      new URL('/api/agents/klavdia/config-audit?section=bogus', 'http://localhost'),
    );
    const res = await GET(req, { params: Promise.resolve({ agentId: 'klavdia' }) });
    const body = (await res.json()) as { entries: PersistedEntry[] };
    expect(body.entries).toHaveLength(1);
  });

  it('returns empty entries for unknown agent', async () => {
    const gw = makeFakeGateway({});
    vi.doMock('@/lib/gateway', () => ({ getGateway: vi.fn().mockResolvedValue(gw) }));
    const { GET } = await import('@/app/api/agents/[agentId]/config-audit/route');
    const req = new NextRequest(
      new URL('/api/agents/ghost/config-audit', 'http://localhost'),
    );
    const res = await GET(req, { params: Promise.resolve({ agentId: 'ghost' }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: PersistedEntry[] };
    expect(body.entries).toEqual([]);
  });

  it('returns empty entries when gateway has no audit log', async () => {
    vi.doMock('@/lib/gateway', () => ({
      getGateway: vi.fn().mockResolvedValue({ getConfigAuditLog: () => null }),
    }));
    const { GET } = await import('@/app/api/agents/[agentId]/config-audit/route');
    const req = new NextRequest(
      new URL('/api/agents/klavdia/config-audit', 'http://localhost'),
    );
    const res = await GET(req, { params: Promise.resolve({ agentId: 'klavdia' }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: PersistedEntry[] };
    expect(body.entries).toEqual([]);
  });
});
