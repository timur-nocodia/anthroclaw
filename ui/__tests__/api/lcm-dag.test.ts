/**
 * Plan 3 Task B1 — UI LCM DAG list + drill-down routes.
 *
 * Reads the per-agent LCM SQLite DB read-only via `ui/lib/lcm.ts` and exposes:
 *   - GET /api/agents/[agentId]/lcm/dag       — list nodes (filterable)
 *   - GET /api/agents/[agentId]/lcm/nodes/[nodeId] — full node detail with children
 *
 * Pattern mirrors plugins.test.ts: tmp dir with a fake `ui` cwd so
 * `process.cwd()/../data/lcm-db/<agent>.sqlite` resolves into the fixture.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { stringify as stringifyYaml } from 'yaml';
import Database from 'better-sqlite3';

// ─── Auth bypass ──────────────────────────────────────────────────────
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

// ─── Fixture: fake repo layout (ui/, agents/, data/lcm-db/) ────────────

let tmpRoot: string;
let agentsDir: string;
let dataDir: string;
let lcmDbDir: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'lcm-dag-api-test-'));
  const fakeUi = join(tmpRoot, 'ui');
  mkdirSync(fakeUi, { recursive: true });
  agentsDir = join(tmpRoot, 'agents');
  mkdirSync(agentsDir, { recursive: true });
  dataDir = join(tmpRoot, 'data');
  lcmDbDir = join(dataDir, 'lcm-db');
  mkdirSync(lcmDbDir, { recursive: true });
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

interface SeedHandles {
  store: import('../../../plugins/lcm/dist/store.js').MessageStore;
  dag: import('../../../plugins/lcm/dist/dag.js').SummaryDAG;
  db: Database.Database;
}

async function seedLcmDb(agentId: string, seed: (h: SeedHandles) => void): Promise<void> {
  const { bootstrap } = await import('../../../plugins/lcm/dist/db/bootstrap.js');
  const { MessageStore } = await import('../../../plugins/lcm/dist/store.js');
  const { SummaryDAG } = await import('../../../plugins/lcm/dist/dag.js');
  const dbPath = join(lcmDbDir, `${agentId}.sqlite`);
  const db = new Database(dbPath);
  bootstrap(db);
  const store = new MessageStore(db);
  const dag = new SummaryDAG(db);
  seed({ store, dag, db });
  db.close();
}

function getReq(url: string): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3000'));
}

// ─── Tests ────────────────────────────────────────────────────────────

describe('GET /api/agents/[agentId]/lcm/dag', () => {
  it('returns empty state (200) when agent has no LCM database', async () => {
    writeAgent('alpha');

    const { GET } = await import('@/app/api/agents/[agentId]/lcm/dag/route');
    const res = await GET(
      getReq('http://localhost:3000/api/agents/alpha/lcm/dag'),
      { params: Promise.resolve({ agentId: 'alpha' }) },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      agentId: 'alpha',
      session: null,
      depth: null,
      totalSessions: 0,
      totalNodes: 0,
      countsByDepth: {},
      nodes: [],
    });
  });

  it('returns 404 for an unknown agent', async () => {
    const { GET } = await import('@/app/api/agents/[agentId]/lcm/dag/route');
    const res = await GET(
      getReq('http://localhost:3000/api/agents/missing/lcm/dag'),
      { params: Promise.resolve({ agentId: 'missing' }) },
    );
    expect(res.status).toBe(404);
  });

  it('returns nodes with correct shape for seeded agent', async () => {
    writeAgent('alpha');
    await seedLcmDb('alpha', ({ store, dag }) => {
      const m1 = store.append({
        session_id: 's1', source: 'telegram', role: 'user', content: 'hello world', ts: 1000,
      });
      const m2 = store.append({
        session_id: 's1', source: 'telegram', role: 'assistant', content: 'hi there', ts: 1100,
      });
      dag.create({
        session_id: 's1',
        depth: 0,
        summary: 'Greeting exchange',
        token_count: 50,
        source_token_count: 200,
        source_ids: [m1, m2],
        source_type: 'messages',
        earliest_at: 1000,
        latest_at: 1100,
      });
    });

    const { GET } = await import('@/app/api/agents/[agentId]/lcm/dag/route');
    const res = await GET(
      getReq('http://localhost:3000/api/agents/alpha/lcm/dag'),
      { params: Promise.resolve({ agentId: 'alpha' }) },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.agentId).toBe('alpha');
    expect(json.totalSessions).toBe(1);
    expect(json.totalNodes).toBe(1);
    expect(json.countsByDepth).toEqual({ 0: 1 });
    expect(json.nodes).toHaveLength(1);
    expect(json.nodes[0]).toMatchObject({
      session_id: 's1',
      depth: 0,
      summary: 'Greeting exchange',
      token_count: 50,
      source_token_count: 200,
      earliest_at: 1000,
      latest_at: 1100,
      child_count: 2,
    });
    expect(typeof json.nodes[0].node_id).toBe('string');
  });

  it('filters by ?session=', async () => {
    writeAgent('alpha');
    await seedLcmDb('alpha', ({ dag }) => {
      dag.create({
        session_id: 's1', depth: 0, summary: 'a', token_count: 1, source_token_count: 1,
        source_ids: [1], source_type: 'messages', earliest_at: 1, latest_at: 1,
      });
      dag.create({
        session_id: 's2', depth: 0, summary: 'b', token_count: 1, source_token_count: 1,
        source_ids: [2], source_type: 'messages', earliest_at: 2, latest_at: 2,
      });
    });

    const { GET } = await import('@/app/api/agents/[agentId]/lcm/dag/route');
    const res = await GET(
      getReq('http://localhost:3000/api/agents/alpha/lcm/dag?session=s1'),
      { params: Promise.resolve({ agentId: 'alpha' }) },
    );
    const json = await res.json();
    expect(json.session).toBe('s1');
    expect(json.totalNodes).toBe(1);
    expect(json.nodes[0].session_id).toBe('s1');
    // totalSessions reflects all sessions in the DAG, independent of filter
    expect(json.totalSessions).toBe(2);
  });

  it('filters by ?depth=0', async () => {
    writeAgent('alpha');
    await seedLcmDb('alpha', ({ dag }) => {
      dag.create({
        session_id: 's1', depth: 0, summary: 'd0', token_count: 1, source_token_count: 1,
        source_ids: [1], source_type: 'messages', earliest_at: 1, latest_at: 1,
      });
      dag.create({
        session_id: 's1', depth: 1, summary: 'd1', token_count: 1, source_token_count: 1,
        source_ids: [], source_type: 'nodes', earliest_at: 2, latest_at: 2,
      });
    });

    const { GET } = await import('@/app/api/agents/[agentId]/lcm/dag/route');
    const res = await GET(
      getReq('http://localhost:3000/api/agents/alpha/lcm/dag?depth=0'),
      { params: Promise.resolve({ agentId: 'alpha' }) },
    );
    const json = await res.json();
    expect(json.depth).toBe(0);
    expect(json.nodes).toHaveLength(1);
    expect(json.nodes[0].depth).toBe(0);
    expect(json.countsByDepth).toEqual({ 0: 1, 1: 1 }); // counts are global, not filtered
  });

  it('combines ?session= and ?depth= filters', async () => {
    writeAgent('alpha');
    await seedLcmDb('alpha', ({ dag }) => {
      dag.create({
        session_id: 's1', depth: 0, summary: 'a', token_count: 1, source_token_count: 1,
        source_ids: [1], source_type: 'messages', earliest_at: 1, latest_at: 1,
      });
      dag.create({
        session_id: 's1', depth: 1, summary: 'b', token_count: 1, source_token_count: 1,
        source_ids: [], source_type: 'nodes', earliest_at: 2, latest_at: 2,
      });
      dag.create({
        session_id: 's2', depth: 0, summary: 'c', token_count: 1, source_token_count: 1,
        source_ids: [2], source_type: 'messages', earliest_at: 3, latest_at: 3,
      });
    });

    const { GET } = await import('@/app/api/agents/[agentId]/lcm/dag/route');
    const res = await GET(
      getReq('http://localhost:3000/api/agents/alpha/lcm/dag?session=s1&depth=0'),
      { params: Promise.resolve({ agentId: 'alpha' }) },
    );
    const json = await res.json();
    expect(json.session).toBe('s1');
    expect(json.depth).toBe(0);
    expect(json.nodes).toHaveLength(1);
    expect(json.nodes[0].summary).toBe('a');
  });

  it('truncates summary to ~200 chars in list response', async () => {
    writeAgent('alpha');
    const longSummary = 'x'.repeat(500);
    await seedLcmDb('alpha', ({ dag }) => {
      dag.create({
        session_id: 's1', depth: 0, summary: longSummary, token_count: 1, source_token_count: 1,
        source_ids: [1], source_type: 'messages', earliest_at: 1, latest_at: 1,
      });
    });

    const { GET } = await import('@/app/api/agents/[agentId]/lcm/dag/route');
    const res = await GET(
      getReq('http://localhost:3000/api/agents/alpha/lcm/dag'),
      { params: Promise.resolve({ agentId: 'alpha' }) },
    );
    const json = await res.json();
    expect(json.nodes[0].summary.length).toBeLessThanOrEqual(204); // 200 + ellipsis tolerance
    expect(json.nodes[0].summary.length).toBeGreaterThan(0);
    expect(json.nodes[0].summary.startsWith('xxx')).toBe(true);
  });

  it('closes DB handle after the request', async () => {
    writeAgent('alpha');
    await seedLcmDb('alpha', ({ dag }) => {
      dag.create({
        session_id: 's1', depth: 0, summary: 's', token_count: 1, source_token_count: 1,
        source_ids: [1], source_type: 'messages', earliest_at: 1, latest_at: 1,
      });
    });

    // Spy on Database.prototype.close — better-sqlite3 default export is the
    // class itself and instances inherit close().
    const closeSpy = vi.spyOn(Database.prototype, 'close');
    closeSpy.mockClear();

    const { GET } = await import('@/app/api/agents/[agentId]/lcm/dag/route');
    const res = await GET(
      getReq('http://localhost:3000/api/agents/alpha/lcm/dag'),
      { params: Promise.resolve({ agentId: 'alpha' }) },
    );
    expect(res.status).toBe(200);
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });
});

describe('GET /api/agents/[agentId]/lcm/nodes/[nodeId]', () => {
  it('returns full detail with messages children for a depth=0 node', async () => {
    writeAgent('alpha');
    let nodeId = '';
    const longSummary = 'A'.repeat(300);
    await seedLcmDb('alpha', ({ store, dag }) => {
      const m1 = store.append({
        session_id: 's1', source: 'telegram', role: 'user', content: 'hello', ts: 1000,
      });
      const m2 = store.append({
        session_id: 's1', source: 'telegram', role: 'assistant', content: 'hi back', ts: 1100,
      });
      nodeId = dag.create({
        session_id: 's1', depth: 0, summary: longSummary, token_count: 50,
        source_token_count: 200, source_ids: [m1, m2], source_type: 'messages',
        earliest_at: 1000, latest_at: 1100,
      });
    });

    const { GET } = await import('@/app/api/agents/[agentId]/lcm/nodes/[nodeId]/route');
    const res = await GET(
      getReq(`http://localhost:3000/api/agents/alpha/lcm/nodes/${nodeId}`),
      { params: Promise.resolve({ agentId: 'alpha', nodeId }) },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    // Full summary returned (NOT truncated)
    expect(json.summary).toBe(longSummary);
    expect(json.summary.length).toBe(300);
    expect(json.node_id).toBe(nodeId);
    expect(json.session_id).toBe('s1');
    expect(json.depth).toBe(0);
    expect(json.source_type).toBe('messages');
    expect(json.source_ids).toEqual([1, 2]);
    expect(json.children).toHaveLength(2);
    expect(json.children[0]).toMatchObject({
      kind: 'message',
      store_id: 1,
      role: 'user',
      content: 'hello',
      ts: 1000,
      source: 'telegram',
    });
    expect(json.children[1]).toMatchObject({
      kind: 'message',
      store_id: 2,
      role: 'assistant',
      content: 'hi back',
    });
  });

  it('returns child node previews for a depth>=1 node', async () => {
    writeAgent('alpha');
    let parentId = '';
    let child1 = '';
    let child2 = '';
    await seedLcmDb('alpha', ({ store, dag }) => {
      const m1 = store.append({
        session_id: 's1', source: 'telegram', role: 'user', content: 'a', ts: 1,
      });
      const m2 = store.append({
        session_id: 's1', source: 'telegram', role: 'user', content: 'b', ts: 2,
      });
      child1 = dag.create({
        session_id: 's1', depth: 0, summary: 'child A summary',
        token_count: 5, source_token_count: 20,
        source_ids: [m1], source_type: 'messages', earliest_at: 1, latest_at: 1,
      });
      child2 = dag.create({
        session_id: 's1', depth: 0, summary: 'child B summary',
        token_count: 5, source_token_count: 20,
        source_ids: [m2], source_type: 'messages', earliest_at: 2, latest_at: 2,
      });
      parentId = dag.create({
        session_id: 's1', depth: 1, summary: 'parent summary',
        token_count: 10, source_token_count: 40,
        source_ids: [child1, child2], source_type: 'nodes',
        earliest_at: 1, latest_at: 2,
      });
    });

    const { GET } = await import('@/app/api/agents/[agentId]/lcm/nodes/[nodeId]/route');
    const res = await GET(
      getReq(`http://localhost:3000/api/agents/alpha/lcm/nodes/${parentId}`),
      { params: Promise.resolve({ agentId: 'alpha', nodeId: parentId }) },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.depth).toBe(1);
    expect(json.source_type).toBe('nodes');
    expect(json.children).toHaveLength(2);
    expect(json.children[0]).toMatchObject({
      kind: 'node',
      node_id: child1,
      depth: 0,
      child_count: 1,
    });
    expect(json.children[0].summary_preview).toContain('child A');
    expect(json.children[1].node_id).toBe(child2);
  });

  it('returns 404 for an unknown nodeId', async () => {
    writeAgent('alpha');
    await seedLcmDb('alpha', ({ dag }) => {
      dag.create({
        session_id: 's1', depth: 0, summary: 's', token_count: 1, source_token_count: 1,
        source_ids: [1], source_type: 'messages', earliest_at: 1, latest_at: 1,
      });
    });

    const { GET } = await import('@/app/api/agents/[agentId]/lcm/nodes/[nodeId]/route');
    const res = await GET(
      getReq('http://localhost:3000/api/agents/alpha/lcm/nodes/01NONEXISTENT0000000000000'),
      { params: Promise.resolve({ agentId: 'alpha', nodeId: '01NONEXISTENT0000000000000' }) },
    );
    expect(res.status).toBe(404);
  });

  it('returns 404 for an unknown agent', async () => {
    const { GET } = await import('@/app/api/agents/[agentId]/lcm/nodes/[nodeId]/route');
    const res = await GET(
      getReq('http://localhost:3000/api/agents/missing/lcm/nodes/01NONEXISTENT0000000000000'),
      { params: Promise.resolve({ agentId: 'missing', nodeId: '01NONEXISTENT0000000000000' }) },
    );
    expect(res.status).toBe(404);
  });

  it('returns 404 when agent exists but has no LCM database', async () => {
    writeAgent('alpha');
    // No seeded DB → DB file does not exist.
    expect(existsSync(join(lcmDbDir, 'alpha.sqlite'))).toBe(false);

    const { GET } = await import('@/app/api/agents/[agentId]/lcm/nodes/[nodeId]/route');
    const res = await GET(
      getReq('http://localhost:3000/api/agents/alpha/lcm/nodes/01ANYTHING000000000000000'),
      { params: Promise.resolve({ agentId: 'alpha', nodeId: '01ANYTHING000000000000000' }) },
    );
    expect(res.status).toBe(404);
  });

  it('uses the lcmDbPath helper to resolve the SQLite location', async () => {
    // Sanity check on the helper: ensures the route + tests agree on path layout.
    const { lcmDbPath } = await import('@/lib/lcm');
    expect(lcmDbPath('alpha')).toBe(resolve(dataDir, 'lcm-db', 'alpha.sqlite'));
  });
});
