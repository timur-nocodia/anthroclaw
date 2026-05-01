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

interface FakeAuditEntry {
  callerAgent: string;
  callerSession?: string;
  targetAgent: string;
  section: string;
  action: string;
  prev: unknown;
  new: unknown;
  source: 'chat' | 'ui' | 'system';
}

function makeFakeWriter() {
  const audit: FakeAuditEntry[] = [];
  const patchSection = vi.fn(
    async (
      agentId: string,
      section: string,
      patch: (current: unknown) => unknown | null,
      ctx?: {
        caller?: string;
        callerSession?: string;
        source?: 'chat' | 'ui' | 'system';
        action?: string;
      },
    ) => {
      const newValue = patch(undefined);
      const entry: FakeAuditEntry = {
        callerAgent: ctx?.caller ?? 'system',
        callerSession: ctx?.callerSession,
        targetAgent: agentId,
        section,
        action: ctx?.action ?? 'patch_section',
        prev: null,
        new: newValue,
        source: ctx?.source ?? 'system',
      };
      audit.push(entry);
      return {
        agentId,
        section,
        prevValue: undefined,
        newValue,
        writtenAt: new Date().toISOString(),
        backupPath: '/tmp/backup',
      };
    },
  );

  const auditLog = {
    append: vi.fn(async () => undefined),
    readRecent: vi.fn(async () => audit.map((e) => ({ ...e, ts: new Date().toISOString() }))),
  };

  return {
    gateway: {
      getAgentConfigWriter: () => ({ patchSection }),
      getConfigAuditLog: () => auditLog,
    },
    patchSection,
    auditLog,
    audit,
  };
}

function jsonRequest(url: string, body: unknown, method = 'PATCH'): NextRequest {
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

describe('PATCH /api/agents/[agentId]/config', () => {
  it('routes the save through AgentConfigWriter with source: ui', async () => {
    const ctx = makeFakeWriter();
    vi.doMock('@/lib/gateway', () => ({
      getGateway: vi.fn().mockResolvedValue(ctx.gateway),
    }));
    const { PATCH } = await import('@/app/api/agents/[agentId]/config/route');
    const req = jsonRequest('/api/agents/amina/config', {
      section: 'human_takeover',
      value: { enabled: true, pause_ttl_minutes: 30 },
    });
    const res = await PATCH(req, { params: Promise.resolve({ agentId: 'amina' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.section).toBe('human_takeover');
    expect(ctx.patchSection).toHaveBeenCalledOnce();
    expect(ctx.patchSection.mock.calls[0][0]).toBe('amina');
    expect(ctx.patchSection.mock.calls[0][1]).toBe('human_takeover');
    expect(ctx.patchSection.mock.calls[0][3]).toMatchObject({ source: 'ui' });
    expect(ctx.audit).toHaveLength(1);
    expect(ctx.audit[0].source).toBe('ui');
  });

  it('rejects unknown section with 400', async () => {
    const ctx = makeFakeWriter();
    vi.doMock('@/lib/gateway', () => ({
      getGateway: vi.fn().mockResolvedValue(ctx.gateway),
    }));
    const { PATCH } = await import('@/app/api/agents/[agentId]/config/route');
    const req = jsonRequest('/api/agents/amina/config', {
      section: 'mcp_tools',
      value: ['memory_search'],
    });
    const res = await PATCH(req, { params: Promise.resolve({ agentId: 'amina' }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_section');
    expect(ctx.patchSection).not.toHaveBeenCalled();
  });

  it('returns 401 when not authenticated', async () => {
    authShouldFail = true;
    const ctx = makeFakeWriter();
    vi.doMock('@/lib/gateway', () => ({
      getGateway: vi.fn().mockResolvedValue(ctx.gateway),
    }));
    const { PATCH } = await import('@/app/api/agents/[agentId]/config/route');
    const req = jsonRequest('/api/agents/amina/config', {
      section: 'human_takeover',
      value: { enabled: true },
    });
    const res = await PATCH(req, { params: Promise.resolve({ agentId: 'amina' }) });
    expect(res.status).toBe(401);
    expect(ctx.patchSection).not.toHaveBeenCalled();
  });

  it('null value passes through to delete the section', async () => {
    const ctx = makeFakeWriter();
    vi.doMock('@/lib/gateway', () => ({
      getGateway: vi.fn().mockResolvedValue(ctx.gateway),
    }));
    const { PATCH } = await import('@/app/api/agents/[agentId]/config/route');
    const req = jsonRequest('/api/agents/amina/config', {
      section: 'notifications',
      value: null,
    });
    const res = await PATCH(req, { params: Promise.resolve({ agentId: 'amina' }) });
    expect(res.status).toBe(200);
    const callPatcher = ctx.patchSection.mock.calls[0][2] as (
      current: unknown,
    ) => unknown | null;
    expect(callPatcher(undefined)).toBeNull();
  });
});
