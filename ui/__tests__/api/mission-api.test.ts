import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { stringify as stringifyYaml } from 'yaml';

process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long!!';
process.env.ADMIN_EMAIL = 'admin@test.com';
process.env.ADMIN_PASSWORD = 'testpassword123';

vi.mock('@/lib/require-auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/require-auth')>('@/lib/require-auth');
  return {
    ...actual,
    requireAuth: vi.fn().mockResolvedValue({ email: 'admin@test.com', authMethod: 'cookie' }),
  };
});

let tmpRoot: string;
let agentsDir: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'mission-api-test-'));
  const fakeUi = join(tmpRoot, 'ui');
  mkdirSync(fakeUi, { recursive: true });
  agentsDir = join(tmpRoot, 'agents');
  mkdirSync(agentsDir, { recursive: true });
  mkdirSync(join(tmpRoot, 'data'), { recursive: true });
  vi.spyOn(process, 'cwd').mockReturnValue(fakeUi);
  vi.resetModules();
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.resetModules();
});

function writeAgent(id: string): void {
  const dir = join(agentsDir, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'agent.yml'),
    stringifyYaml({
      model: 'claude-sonnet-4-6',
      routes: [{ channel: 'telegram', scope: 'dm' }],
    }),
    'utf-8',
  );
}

function req(url: string, body?: unknown, method = 'GET'): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3000'), {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('/api/agents/[agentId]/mission', () => {
  it('GET returns inactive state when mission DB is missing', async () => {
    writeAgent('alpha');
    const { GET } = await import('@/app/api/agents/[agentId]/mission/route');

    const res = await GET(
      req('http://localhost:3000/api/agents/alpha/mission'),
      { params: Promise.resolve({ agentId: 'alpha' }) },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ active: false, agentId: 'alpha' });
  });

  it('POST creates a mission and GET reads it back', async () => {
    writeAgent('alpha');
    const { GET, POST } = await import('@/app/api/agents/[agentId]/mission/route');

    const create = await POST(
      req('http://localhost:3000/api/agents/alpha/mission', {
        title: 'Mission State',
        goal: 'Keep long-running work scoped',
        mode: 'lifecycle',
        current_state: 'API layer',
        next_actions: ['add panel'],
      }, 'POST'),
      { params: Promise.resolve({ agentId: 'alpha' }) },
    );
    expect(create.status).toBe(200);
    const created = await create.json();
    expect(created.active).toBe(true);
    expect(created.mission.title).toBe('Mission State');
    expect(created.mission.next_actions).toEqual(['add panel']);

    const read = await GET(
      req('http://localhost:3000/api/agents/alpha/mission'),
      { params: Promise.resolve({ agentId: 'alpha' }) },
    );
    const json = await read.json();
    expect(json.mission.title).toBe('Mission State');
    expect(json.mission.mode).toBe('lifecycle');
  });

  it('POST returns 400 for invalid body', async () => {
    writeAgent('alpha');
    const { POST } = await import('@/app/api/agents/[agentId]/mission/route');

    const res = await POST(
      req('http://localhost:3000/api/agents/alpha/mission', { title: '' }, 'POST'),
      { params: Promise.resolve({ agentId: 'alpha' }) },
    );

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('invalid_body');
    expect(Array.isArray(json.issues)).toBe(true);
  });

  it('DELETE archives the active mission without deleting it', async () => {
    writeAgent('alpha');
    const { GET, POST, DELETE } = await import('@/app/api/agents/[agentId]/mission/route');

    await POST(
      req('http://localhost:3000/api/agents/alpha/mission', {
        title: 'Temporary',
        goal: 'Archive me',
      }, 'POST'),
      { params: Promise.resolve({ agentId: 'alpha' }) },
    );

    const archive = await DELETE(
      req('http://localhost:3000/api/agents/alpha/mission', { reason: 'done' }, 'DELETE'),
      { params: Promise.resolve({ agentId: 'alpha' }) },
    );
    expect(archive.status).toBe(200);
    const archived = await archive.json();
    expect(archived.active).toBe(false);
    expect(archived.mission.status).toBe('archived');

    const read = await GET(
      req('http://localhost:3000/api/agents/alpha/mission'),
      { params: Promise.resolve({ agentId: 'alpha' }) },
    );
    expect(await read.json()).toEqual({ active: false, agentId: 'alpha' });
  });

  it('returns 404 for an unknown agent', async () => {
    const { GET } = await import('@/app/api/agents/[agentId]/mission/route');

    const res = await GET(
      req('http://localhost:3000/api/agents/missing/mission'),
      { params: Promise.resolve({ agentId: 'missing' }) },
    );

    expect(res.status).toBe(404);
  });
});
