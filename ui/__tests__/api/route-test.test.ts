import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

interface FakeRoute {
  agentId: string;
  channel: string;
  accountId: string;
  scope: string;
  peers: string[] | null;
  topics: string[] | null;
  mentionOnly: boolean;
  priority: number;
}

interface FakeAgentConfig {
  pairing?: { mode: string };
  allowlist?: Record<string, string[]>;
}

function makeFakeGateway(opts: {
  route?: FakeRoute | null;
  topicMismatchHint?: string;
  agentConfig?: FakeAgentConfig;
} = {}) {
  const route = opts.route === undefined
    ? null
    : opts.route;
  return {
    getRouteTable: () => ({
      resolve: vi.fn(() => route),
    }),
    getAgent: () => opts.agentConfig
      ? { id: 'operator_agent', config: opts.agentConfig }
      : undefined,
  };
}

function jsonRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3000'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const validBody = {
  channel: 'telegram',
  account_id: 'content_sm',
  chat_type: 'group',
  peer_id: '-1003729315809',
  thread_id: '3',
  sender_id: '48705953',
  text: '@clowwy_bot show_config',
  mentioned_bot: true,
};

const matchingRoute: FakeRoute = {
  agentId: 'operator_agent',
  channel: 'telegram',
  accountId: 'content_sm',
  scope: 'group',
  peers: ['-1003729315809'],
  topics: ['3'],
  mentionOnly: true,
  priority: 15,
};

beforeEach(() => {
  authShouldFail = false;
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('POST /api/agents/[id]/route-test', () => {
  it('returns 401 without auth', async () => {
    authShouldFail = true;
    vi.doMock('@/lib/gateway', () => ({
      getGateway: vi.fn().mockResolvedValue(makeFakeGateway()),
    }));
    const { POST } = await import('@/app/api/agents/[agentId]/route-test/route');
    const req = jsonRequest('/api/agents/operator_agent/route-test', validBody);
    const res = await POST(req, { params: Promise.resolve({ agentId: 'operator_agent' }) });
    expect(res.status).toBe(401);
  });

  it('returns matched: true when route + access pass', async () => {
    vi.doMock('@/lib/gateway', () => ({
      getGateway: vi.fn().mockResolvedValue(makeFakeGateway({
        route: matchingRoute,
        agentConfig: { pairing: { mode: 'open' } },
      })),
    }));
    const { POST } = await import('@/app/api/agents/[agentId]/route-test/route');
    const res = await POST(
      jsonRequest('/api/agents/operator_agent/route-test', validBody),
      { params: Promise.resolve({ agentId: 'operator_agent' }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      matched: true,
      agent_id: 'operator_agent',
      blockers: [],
    });
    expect(body.session_key).toContain('thread:3');
    expect(body.session_key).toContain('operator_agent');
    expect(body.session_key).toContain('telegram');
  });

  it('returns matched: false with reason when topic mismatches', async () => {
    vi.doMock('@/lib/gateway', () => ({
      getGateway: vi.fn().mockResolvedValue(makeFakeGateway({
        route: null,
        agentConfig: { pairing: { mode: 'open' } },
      })),
    }));
    const { POST } = await import('@/app/api/agents/[agentId]/route-test/route');
    const res = await POST(
      jsonRequest('/api/agents/operator_agent/route-test', { ...validBody, thread_id: '99' }),
      { params: Promise.resolve({ agentId: 'operator_agent' }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.matched).toBe(false);
    expect(body.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stage: 'route' }),
      ]),
    );
    expect(body.blockers[0].reason).toMatch(/topic|route|peer|match/i);
  });

  it('returns blocker when mention_only and not mentioned', async () => {
    vi.doMock('@/lib/gateway', () => ({
      getGateway: vi.fn().mockResolvedValue(makeFakeGateway({
        route: matchingRoute,
        agentConfig: { pairing: { mode: 'open' } },
      })),
    }));
    const { POST } = await import('@/app/api/agents/[agentId]/route-test/route');
    const res = await POST(
      jsonRequest('/api/agents/operator_agent/route-test', { ...validBody, mentioned_bot: false }),
      { params: Promise.resolve({ agentId: 'operator_agent' }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.matched).toBe(false);
    expect(body.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stage: 'mention' }),
      ]),
    );
  });

  it('returns blocker when sender not in allowlist (pairing.mode: off)', async () => {
    vi.doMock('@/lib/gateway', () => ({
      getGateway: vi.fn().mockResolvedValue(makeFakeGateway({
        route: matchingRoute,
        agentConfig: {
          pairing: { mode: 'off' },
          allowlist: { telegram: ['9999'] },
        },
      })),
    }));
    const { POST } = await import('@/app/api/agents/[agentId]/route-test/route');
    const res = await POST(
      jsonRequest('/api/agents/operator_agent/route-test', validBody),
      { params: Promise.resolve({ agentId: 'operator_agent' }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.matched).toBe(false);
    expect(body.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stage: 'access' }),
      ]),
    );
  });

  it('flags matched route owned by different agent', async () => {
    vi.doMock('@/lib/gateway', () => ({
      getGateway: vi.fn().mockResolvedValue(makeFakeGateway({
        route: { ...matchingRoute, agentId: 'other_agent' },
        agentConfig: { pairing: { mode: 'open' } },
      })),
    }));
    const { POST } = await import('@/app/api/agents/[agentId]/route-test/route');
    const res = await POST(
      jsonRequest('/api/agents/operator_agent/route-test', validBody),
      { params: Promise.resolve({ agentId: 'operator_agent' }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.matched).toBe(false);
    expect(body.agent_id).toBe('other_agent');
    expect(body.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stage: 'route' }),
      ]),
    );
  });

  it('returns 400 on invalid body', async () => {
    vi.doMock('@/lib/gateway', () => ({
      getGateway: vi.fn().mockResolvedValue(makeFakeGateway()),
    }));
    const { POST } = await import('@/app/api/agents/[agentId]/route-test/route');
    const res = await POST(
      jsonRequest('/api/agents/operator_agent/route-test', { channel: 'telegram' }),
      { params: Promise.resolve({ agentId: 'operator_agent' }) },
    );
    expect(res.status).toBe(400);
  });
});
