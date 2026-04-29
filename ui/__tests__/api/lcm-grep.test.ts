/**
 * Plan 3 Task B2 — UI LCM grep route.
 *
 * GET /api/agents/[agentId]/lcm/grep?q=...&session=...&source=...&sort=...&limit=...
 *
 * Searches messages + DAG summary nodes via the LCM SQLite (read-only),
 * merges results, sorts by rank ASC (FTS5 BM25 convention: lower = better),
 * and returns a paginated response with `truncated` flag.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  tmpRoot = mkdtempSync(join(tmpdir(), 'lcm-grep-api-test-'));
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

describe('GET /api/agents/[agentId]/lcm/grep — validation', () => {
  it('returns 400 when q is missing', async () => {
    writeAgent('alpha');
    const { GET } = await import('@/app/api/agents/[agentId]/lcm/grep/route');
    const res = await GET(
      getReq('http://localhost:3000/api/agents/alpha/lcm/grep'),
      { params: Promise.resolve({ agentId: 'alpha' }) },
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('invalid_query');
  });

  it('returns 400 when q is whitespace only', async () => {
    writeAgent('alpha');
    const { GET } = await import('@/app/api/agents/[agentId]/lcm/grep/route');
    const res = await GET(
      getReq('http://localhost:3000/api/agents/alpha/lcm/grep?q=%20%20%20'),
      { params: Promise.resolve({ agentId: 'alpha' }) },
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('invalid_query');
  });

  it('returns 404 for an unknown agent', async () => {
    const { GET } = await import('@/app/api/agents/[agentId]/lcm/grep/route');
    const res = await GET(
      getReq('http://localhost:3000/api/agents/missing/lcm/grep?q=hello'),
      { params: Promise.resolve({ agentId: 'missing' }) },
    );
    expect(res.status).toBe(404);
  });
});

describe('GET /api/agents/[agentId]/lcm/grep — empty / missing DB', () => {
  it('returns 200 with empty hits when agent has no LCM DB', async () => {
    writeAgent('alpha');
    const { GET } = await import('@/app/api/agents/[agentId]/lcm/grep/route');
    const res = await GET(
      getReq('http://localhost:3000/api/agents/alpha/lcm/grep?q=hello'),
      { params: Promise.resolve({ agentId: 'alpha' }) },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      agentId: 'alpha',
      query: 'hello',
      hits: [],
      totalReturned: 0,
      truncated: false,
    });
  });

  it('returns 200 with empty hits when LCM file exists but schema is missing', async () => {
    writeAgent('alpha');
    const dbPath = join(lcmDbDir, 'alpha.sqlite');
    const db = new Database(dbPath);
    db.exec('CREATE TABLE foo (x INTEGER)');
    db.close();

    const { GET } = await import('@/app/api/agents/[agentId]/lcm/grep/route');
    const res = await GET(
      getReq('http://localhost:3000/api/agents/alpha/lcm/grep?q=hello'),
      { params: Promise.resolve({ agentId: 'alpha' }) },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.hits).toEqual([]);
    expect(json.totalReturned).toBe(0);
    expect(json.truncated).toBe(false);
  });
});

describe('GET /api/agents/[agentId]/lcm/grep — happy path', () => {
  it('returns hits with both message and node kinds', async () => {
    writeAgent('alpha');
    await seedLcmDb('alpha', ({ store, dag }) => {
      const m1 = store.append({
        session_id: 's1', source: 'telegram', role: 'user',
        content: 'hello world from telegram', ts: 1000,
      });
      const m2 = store.append({
        session_id: 's1', source: 'telegram', role: 'assistant',
        content: 'unrelated content here', ts: 1100,
      });
      dag.create({
        session_id: 's1', depth: 0,
        summary: 'A hello greeting summary',
        token_count: 50, source_token_count: 200,
        source_ids: [m1, m2], source_type: 'messages',
        earliest_at: 1000, latest_at: 1100,
      });
    });

    const { GET } = await import('@/app/api/agents/[agentId]/lcm/grep/route');
    const res = await GET(
      getReq('http://localhost:3000/api/agents/alpha/lcm/grep?q=hello'),
      { params: Promise.resolve({ agentId: 'alpha' }) },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.agentId).toBe('alpha');
    expect(json.query).toBe('hello');
    const kinds = json.hits.map((h: { kind: string }) => h.kind).sort();
    expect(kinds).toContain('message');
    expect(kinds).toContain('node');
    expect(json.totalReturned).toBe(json.hits.length);

    const msgHit = json.hits.find((h: { kind: string }) => h.kind === 'message');
    expect(msgHit).toMatchObject({
      kind: 'message',
      session_id: 's1',
      source: 'telegram',
      role: 'user',
      ts: 1000,
    });
    expect(typeof msgHit.store_id).toBe('number');
    expect(typeof msgHit.snippet).toBe('string');
    expect(typeof msgHit.rank).toBe('number');

    const nodeHit = json.hits.find((h: { kind: string }) => h.kind === 'node');
    expect(nodeHit).toMatchObject({
      kind: 'node',
      session_id: 's1',
      depth: 0,
    });
    expect(typeof nodeHit.node_id).toBe('string');
    expect(typeof nodeHit.snippet).toBe('string');
    expect(typeof nodeHit.rank).toBe('number');
  });

  it('hits are sorted by rank ascending (lower = more relevant)', async () => {
    writeAgent('alpha');
    await seedLcmDb('alpha', ({ store }) => {
      // Several messages so FTS5 produces distinct ranks
      store.append({
        session_id: 's1', source: 'telegram', role: 'user',
        content: 'banana banana banana hello', ts: 1000,
      });
      store.append({
        session_id: 's1', source: 'telegram', role: 'user',
        content: 'hello hello hello banana banana', ts: 1100,
      });
      store.append({
        session_id: 's1', source: 'telegram', role: 'user',
        content: 'hello hello banana', ts: 1200,
      });
    });

    const { GET } = await import('@/app/api/agents/[agentId]/lcm/grep/route');
    const res = await GET(
      getReq('http://localhost:3000/api/agents/alpha/lcm/grep?q=hello'),
      { params: Promise.resolve({ agentId: 'alpha' }) },
    );
    const json = await res.json();
    expect(json.hits.length).toBeGreaterThan(1);
    const ranks = json.hits.map((h: { rank: number }) => h.rank);
    for (let i = 1; i < ranks.length; i++) {
      expect(ranks[i]).toBeGreaterThanOrEqual(ranks[i - 1]);
    }
  });
});

describe('GET /api/agents/[agentId]/lcm/grep — filters', () => {
  it('?session= filters both message and node search', async () => {
    writeAgent('alpha');
    await seedLcmDb('alpha', ({ store, dag }) => {
      const ma = store.append({
        session_id: 's1', source: 'telegram', role: 'user',
        content: 'hello session one', ts: 1000,
      });
      store.append({
        session_id: 's2', source: 'telegram', role: 'user',
        content: 'hello session two', ts: 2000,
      });
      dag.create({
        session_id: 's1', depth: 0,
        summary: 'hello s1 summary',
        token_count: 5, source_token_count: 20,
        source_ids: [ma], source_type: 'messages',
        earliest_at: 1000, latest_at: 1000,
      });
      dag.create({
        session_id: 's2', depth: 0,
        summary: 'hello s2 summary',
        token_count: 5, source_token_count: 20,
        source_ids: [1], source_type: 'messages',
        earliest_at: 2000, latest_at: 2000,
      });
    });

    const { GET } = await import('@/app/api/agents/[agentId]/lcm/grep/route');
    const res = await GET(
      getReq('http://localhost:3000/api/agents/alpha/lcm/grep?q=hello&session=s1'),
      { params: Promise.resolve({ agentId: 'alpha' }) },
    );
    const json = await res.json();
    expect(json.hits.length).toBeGreaterThan(0);
    for (const hit of json.hits) {
      expect(hit.session_id).toBe('s1');
    }
  });

  it('?source=telegram filters message search', async () => {
    writeAgent('alpha');
    await seedLcmDb('alpha', ({ store }) => {
      store.append({
        session_id: 's1', source: 'telegram', role: 'user',
        content: 'hello via telegram', ts: 1000,
      });
      store.append({
        session_id: 's1', source: 'whatsapp', role: 'user',
        content: 'hello via whatsapp', ts: 1100,
      });
    });

    const { GET } = await import('@/app/api/agents/[agentId]/lcm/grep/route');
    const res = await GET(
      getReq('http://localhost:3000/api/agents/alpha/lcm/grep?q=hello&source=telegram'),
      { params: Promise.resolve({ agentId: 'alpha' }) },
    );
    const json = await res.json();
    const msgHits = json.hits.filter((h: { kind: string }) => h.kind === 'message');
    expect(msgHits.length).toBeGreaterThan(0);
    for (const h of msgHits) {
      expect(h.source).toBe('telegram');
    }
  });

  it('?sort=relevance and ?sort=recency are honored', async () => {
    writeAgent('alpha');
    await seedLcmDb('alpha', ({ store }) => {
      // Older message with many hits → high relevance
      store.append({
        session_id: 's1', source: 'telegram', role: 'user',
        content: 'hello hello hello hello',
        ts: 1000,
      });
      // Newer message with fewer hits → high recency, lower relevance
      store.append({
        session_id: 's1', source: 'telegram', role: 'user',
        content: 'hello once',
        ts: 9999,
      });
    });

    const { GET } = await import('@/app/api/agents/[agentId]/lcm/grep/route');

    const resRel = await GET(
      getReq('http://localhost:3000/api/agents/alpha/lcm/grep?q=hello&sort=relevance'),
      { params: Promise.resolve({ agentId: 'alpha' }) },
    );
    const jsonRel = await resRel.json();
    const msgsRel = jsonRel.hits.filter((h: { kind: string }) => h.kind === 'message');
    expect(msgsRel[0].ts).toBe(1000); // best relevance is older

    const resRec = await GET(
      getReq('http://localhost:3000/api/agents/alpha/lcm/grep?q=hello&sort=recency'),
      { params: Promise.resolve({ agentId: 'alpha' }) },
    );
    const jsonRec = await resRec.json();
    const msgsRec = jsonRec.hits.filter((h: { kind: string }) => h.kind === 'message');
    expect(msgsRec[0].ts).toBe(9999); // newest first
  });
});

describe('GET /api/agents/[agentId]/lcm/grep — limit + truncation', () => {
  it('?limit=5 caps the response and sets truncated=true when more matches exist', async () => {
    writeAgent('alpha');
    await seedLcmDb('alpha', ({ store, dag }) => {
      // 20 messages mentioning hello
      const ids: number[] = [];
      for (let i = 0; i < 20; i++) {
        ids.push(store.append({
          session_id: 's1', source: 'telegram', role: 'user',
          content: `hello world number ${i}`, ts: 1000 + i,
        }));
      }
      // 5 nodes mentioning hello
      for (let i = 0; i < 5; i++) {
        dag.create({
          session_id: 's1', depth: 0,
          summary: `hello summary ${i}`,
          token_count: 1, source_token_count: 1,
          source_ids: [ids[i]], source_type: 'messages',
          earliest_at: 1000 + i, latest_at: 1000 + i,
        });
      }
    });

    const { GET } = await import('@/app/api/agents/[agentId]/lcm/grep/route');
    const res = await GET(
      getReq('http://localhost:3000/api/agents/alpha/lcm/grep?q=hello&limit=5'),
      { params: Promise.resolve({ agentId: 'alpha' }) },
    );
    const json = await res.json();
    expect(json.hits).toHaveLength(5);
    expect(json.totalReturned).toBe(5);
    expect(json.truncated).toBe(true);
  });

  it('truncated=false when total matches <= limit', async () => {
    writeAgent('alpha');
    await seedLcmDb('alpha', ({ store }) => {
      store.append({
        session_id: 's1', source: 'telegram', role: 'user',
        content: 'hello unique', ts: 1000,
      });
    });

    const { GET } = await import('@/app/api/agents/[agentId]/lcm/grep/route');
    const res = await GET(
      getReq('http://localhost:3000/api/agents/alpha/lcm/grep?q=unique&limit=10'),
      { params: Promise.resolve({ agentId: 'alpha' }) },
    );
    const json = await res.json();
    expect(json.hits.length).toBeLessThanOrEqual(10);
    expect(json.truncated).toBe(false);
  });

  it('?limit=999 is clamped to 100', async () => {
    writeAgent('alpha');
    await seedLcmDb('alpha', ({ store }) => {
      // Seed 150 messages so that, if the route forwarded limit=999, we'd
      // get >100 hits back. Capping at 100 ensures the upper bound holds.
      for (let i = 0; i < 150; i++) {
        store.append({
          session_id: 's1', source: 'telegram', role: 'user',
          content: `hello entry ${i}`, ts: 1000 + i,
        });
      }
    });

    const { GET } = await import('@/app/api/agents/[agentId]/lcm/grep/route');
    const res = await GET(
      getReq('http://localhost:3000/api/agents/alpha/lcm/grep?q=hello&limit=999'),
      { params: Promise.resolve({ agentId: 'alpha' }) },
    );
    const json = await res.json();
    expect(json.hits.length).toBeLessThanOrEqual(100);
    expect(json.truncated).toBe(true);
  });
});

describe('GET /api/agents/[agentId]/lcm/grep — DB lifecycle', () => {
  it('closes the DB handle after the request', async () => {
    writeAgent('alpha');
    await seedLcmDb('alpha', ({ store }) => {
      store.append({
        session_id: 's1', source: 'telegram', role: 'user',
        content: 'hello there', ts: 1000,
      });
    });

    const closeSpy = vi.spyOn(Database.prototype, 'close');
    closeSpy.mockClear();

    const { GET } = await import('@/app/api/agents/[agentId]/lcm/grep/route');
    const res = await GET(
      getReq('http://localhost:3000/api/agents/alpha/lcm/grep?q=hello'),
      { params: Promise.resolve({ agentId: 'alpha' }) },
    );
    expect(res.status).toBe(200);
    expect(closeSpy).toHaveBeenCalledTimes(1);
    closeSpy.mockRestore();
  });
});
