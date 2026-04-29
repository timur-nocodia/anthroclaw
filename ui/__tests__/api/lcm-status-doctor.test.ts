/**
 * Plan 3 Task C1 — UI LCM status + doctor bridge APIs.
 *
 *   GET  /api/agents/[agentId]/lcm/status — pressure snapshot
 *   POST /api/agents/[agentId]/lcm/doctor — health check + double-gated cleanup
 *
 * Both routes read SQLite directly (no live gateway dependency). Doctor opens
 * the DB writable when applying. Pattern mirrors lcm-dag.test.ts.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, existsSync } from 'node:fs';
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

// ─── Fixture: fake repo layout (ui/, agents/, data/lcm/lcm-db/) ───────

let tmpRoot: string;
let agentsDir: string;
let dataDir: string;
let lcmDbDir: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'lcm-status-doctor-api-test-'));
  const fakeUi = join(tmpRoot, 'ui');
  mkdirSync(fakeUi, { recursive: true });
  agentsDir = join(tmpRoot, 'agents');
  mkdirSync(agentsDir, { recursive: true });
  dataDir = join(tmpRoot, 'data');
  lcmDbDir = join(dataDir, 'lcm', 'lcm-db');
  mkdirSync(lcmDbDir, { recursive: true });
  vi.spyOn(process, 'cwd').mockReturnValue(fakeUi);
  vi.resetModules();
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.resetModules();
});

function writeAgent(id: string, extra?: Record<string, unknown>): void {
  const dir = join(agentsDir, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'agent.yml'),
    stringifyYaml({
      model: 'claude-sonnet-4-6',
      routes: [{ channel: 'telegram', scope: 'dm' }],
      ...(extra ?? {}),
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

function postReq(url: string, body: unknown): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3000'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ─── Status route tests ───────────────────────────────────────────────

describe('GET /api/agents/[agentId]/lcm/status', () => {
  it('returns 404 for an unknown agent', async () => {
    const { GET } = await import('@/app/api/agents/[agentId]/lcm/status/route');
    const res = await GET(
      getReq('http://localhost:3000/api/agents/missing/lcm/status'),
      { params: Promise.resolve({ agentId: 'missing' }) },
    );
    expect(res.status).toBe(404);
  });

  it('returns 200 with all zeros + pressure: green when LCM DB is missing', async () => {
    writeAgent('alpha');

    const { GET } = await import('@/app/api/agents/[agentId]/lcm/status/route');
    const res = await GET(
      getReq('http://localhost:3000/api/agents/alpha/lcm/status'),
      { params: Promise.resolve({ agentId: 'alpha' }) },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.agentId).toBe('alpha');
    expect(json.session).toBeNull();
    expect(json.totalSessions).toBe(0);
    expect(json.totalMessages).toBe(0);
    expect(json.totalTokens).toBe(0);
    expect(json.countsByDepth).toEqual({});
    expect(json.contextPressure).toBe('green');
    expect(json.threshold).toBe(40000);
    expect(json.pressureRatio).toBe(0);
    expect(json.earliestTs).toBeNull();
    expect(json.latestTs).toBeNull();
  });

  it('returns correct counts for a seeded agent', async () => {
    writeAgent('alpha');
    await seedLcmDb('alpha', ({ store, dag }) => {
      store.append({ session_id: 's1', source: 'cli', role: 'user', content: 'hello world', ts: 1000 });
      store.append({ session_id: 's1', source: 'cli', role: 'assistant', content: 'hi back', ts: 2000 });
      store.append({ session_id: 's2', source: 'cli', role: 'user', content: 'hi again', ts: 3000 });
      dag.create({
        session_id: 's1', depth: 0, summary: 'd0 s1', token_count: 10, source_token_count: 50,
        source_ids: [1, 2], source_type: 'messages', earliest_at: 1000, latest_at: 2000,
      });
      dag.create({
        session_id: 's1', depth: 1, summary: 'd1 s1', token_count: 5, source_token_count: 10,
        source_ids: [], source_type: 'nodes', earliest_at: 1000, latest_at: 2000,
      });
      dag.create({
        session_id: 's2', depth: 0, summary: 'd0 s2', token_count: 8, source_token_count: 40,
        source_ids: [3], source_type: 'messages', earliest_at: 3000, latest_at: 3000,
      });
    });

    const { GET } = await import('@/app/api/agents/[agentId]/lcm/status/route');
    const res = await GET(
      getReq('http://localhost:3000/api/agents/alpha/lcm/status'),
      { params: Promise.resolve({ agentId: 'alpha' }) },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.totalSessions).toBe(2);
    expect(json.totalMessages).toBe(3);
    expect(json.totalTokens).toBeGreaterThan(0);
    expect(json.countsByDepth).toEqual({ 0: 2, 1: 1 });
    expect(json.earliestTs).toBe(1000);
    expect(json.latestTs).toBe(3000);
  });

  it('?session= filter narrows counts to a single session', async () => {
    writeAgent('alpha');
    await seedLcmDb('alpha', ({ store, dag }) => {
      store.append({ session_id: 's1', source: 'cli', role: 'user', content: 'a', ts: 1 });
      store.append({ session_id: 's1', source: 'cli', role: 'user', content: 'b', ts: 2 });
      store.append({ session_id: 's2', source: 'cli', role: 'user', content: 'c', ts: 3 });
      dag.create({
        session_id: 's1', depth: 0, summary: 's1', token_count: 1, source_token_count: 1,
        source_ids: [1], source_type: 'messages', earliest_at: 1, latest_at: 1,
      });
      dag.create({
        session_id: 's2', depth: 0, summary: 's2', token_count: 1, source_token_count: 1,
        source_ids: [3], source_type: 'messages', earliest_at: 3, latest_at: 3,
      });
    });

    const { GET } = await import('@/app/api/agents/[agentId]/lcm/status/route');
    const res = await GET(
      getReq('http://localhost:3000/api/agents/alpha/lcm/status?session=s1'),
      { params: Promise.resolve({ agentId: 'alpha' }) },
    );
    const json = await res.json();
    expect(json.session).toBe('s1');
    expect(json.totalMessages).toBe(2);
    expect(json.countsByDepth).toEqual({ 0: 1 });
    // totalSessions remains agent-wide (both s1 + s2)
    expect(json.totalSessions).toBe(2);
  });

  it('threshold defaults to 40000 when no plugin config is set', async () => {
    writeAgent('alpha');
    const { GET } = await import('@/app/api/agents/[agentId]/lcm/status/route');
    const res = await GET(
      getReq('http://localhost:3000/api/agents/alpha/lcm/status'),
      { params: Promise.resolve({ agentId: 'alpha' }) },
    );
    const json = await res.json();
    expect(json.threshold).toBe(40000);
  });

  it('threshold pulled from agent plugin config when present', async () => {
    writeAgent('alpha', {
      plugins: {
        lcm: {
          enabled: true,
          triggers: { compress_threshold_tokens: 12345 },
        },
      },
    });
    const { GET } = await import('@/app/api/agents/[agentId]/lcm/status/route');
    const res = await GET(
      getReq('http://localhost:3000/api/agents/alpha/lcm/status'),
      { params: Promise.resolve({ agentId: 'alpha' }) },
    );
    const json = await res.json();
    expect(json.threshold).toBe(12345);
  });

  // For the pressure-bucket tests we directly write the token_estimate column
  // so we don't depend on the tokenizer (tiktoken vs. char/4 fallback) for
  // bucket boundaries. Bypassing the FTS trigger is fine because pressure does
  // not look at FTS.
  async function seedTokens(agentId: string, totalTokens: number): Promise<void> {
    const { bootstrap } = await import('../../../plugins/lcm/dist/db/bootstrap.js');
    const dbPath = join(lcmDbDir, `${agentId}.sqlite`);
    const db = new Database(dbPath);
    bootstrap(db);
    db.prepare(
      `INSERT INTO messages (session_id, source, role, content, ts, token_estimate)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('s1', 'cli', 'user', 'pressure-test-payload', 1, totalTokens);
    db.close();
  }

  it('pressure: green when below 50% threshold (0% case)', async () => {
    writeAgent('alpha', {
      plugins: { lcm: { enabled: true, triggers: { compress_threshold_tokens: 1000 } } },
    });
    // 0 tokens (no messages at all)
    const { GET } = await import('@/app/api/agents/[agentId]/lcm/status/route');
    const res = await GET(
      getReq('http://localhost:3000/api/agents/alpha/lcm/status'),
      { params: Promise.resolve({ agentId: 'alpha' }) },
    );
    const json = await res.json();
    expect(json.contextPressure).toBe('green');
    expect(json.pressureRatio).toBe(0);
  });

  it('pressure: yellow when ~60% of threshold', async () => {
    writeAgent('alpha', {
      plugins: { lcm: { enabled: true, triggers: { compress_threshold_tokens: 1000 } } },
    });
    await seedTokens('alpha', 600);
    const { GET } = await import('@/app/api/agents/[agentId]/lcm/status/route');
    const res = await GET(
      getReq('http://localhost:3000/api/agents/alpha/lcm/status'),
      { params: Promise.resolve({ agentId: 'alpha' }) },
    );
    const json = await res.json();
    expect(json.contextPressure).toBe('yellow');
    expect(json.pressureRatio).toBeCloseTo(0.6, 5);
  });

  it('pressure: orange when ~85% of threshold', async () => {
    writeAgent('alpha', {
      plugins: { lcm: { enabled: true, triggers: { compress_threshold_tokens: 1000 } } },
    });
    await seedTokens('alpha', 850);
    const { GET } = await import('@/app/api/agents/[agentId]/lcm/status/route');
    const res = await GET(
      getReq('http://localhost:3000/api/agents/alpha/lcm/status'),
      { params: Promise.resolve({ agentId: 'alpha' }) },
    );
    const json = await res.json();
    expect(json.contextPressure).toBe('orange');
    expect(json.pressureRatio).toBeCloseTo(0.85, 5);
  });

  it('pressure: red at 100%+ of threshold and ratio capped at 1.5', async () => {
    writeAgent('alpha', {
      plugins: { lcm: { enabled: true, triggers: { compress_threshold_tokens: 1000 } } },
    });
    await seedTokens('alpha', 5000); // 5x threshold → ratio cap at 1.5
    const { GET } = await import('@/app/api/agents/[agentId]/lcm/status/route');
    const res = await GET(
      getReq('http://localhost:3000/api/agents/alpha/lcm/status'),
      { params: Promise.resolve({ agentId: 'alpha' }) },
    );
    const json = await res.json();
    expect(json.contextPressure).toBe('red');
    expect(json.pressureRatio).toBe(1.5);
  });
});

// ─── Doctor route tests ───────────────────────────────────────────────

describe('POST /api/agents/[agentId]/lcm/doctor', () => {
  it('returns 404 for an unknown agent', async () => {
    const { POST } = await import('@/app/api/agents/[agentId]/lcm/doctor/route');
    const res = await POST(
      postReq('http://localhost:3000/api/agents/missing/lcm/doctor', { apply: false }),
      { params: Promise.resolve({ agentId: 'missing' }) },
    );
    expect(res.status).toBe(404);
  });

  it('returns 200 health: green with no issues when LCM DB is missing', async () => {
    writeAgent('alpha');
    const { POST } = await import('@/app/api/agents/[agentId]/lcm/doctor/route');
    const res = await POST(
      postReq('http://localhost:3000/api/agents/alpha/lcm/doctor', { apply: false }),
      { params: Promise.resolve({ agentId: 'alpha' }) },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.agentId).toBe('alpha');
    expect(json.health).toBe('green');
    expect(json.issues).toEqual([]);
    expect(json.cleanup).toBeUndefined();
  });

  it('healthy seeded DB returns green health', async () => {
    writeAgent('alpha');
    await seedLcmDb('alpha', ({ store, dag }) => {
      store.append({ session_id: 's1', source: 'cli', role: 'user', content: 'a', ts: 1 });
      dag.create({
        session_id: 's1', depth: 0, summary: 'ok', token_count: 1, source_token_count: 1,
        source_ids: [1], source_type: 'messages', earliest_at: 1, latest_at: 1,
      });
    });
    const { POST } = await import('@/app/api/agents/[agentId]/lcm/doctor/route');
    const res = await POST(
      postReq('http://localhost:3000/api/agents/alpha/lcm/doctor', { apply: false }),
      { params: Promise.resolve({ agentId: 'alpha' }) },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.health).toBe('green');
    expect(json.issues).toEqual([]);
  });

  it('orphan node references produce a non-green health + orphan_nodes issue', async () => {
    writeAgent('alpha');
    await seedLcmDb('alpha', ({ dag }) => {
      // A parent node referencing a non-existent child id
      dag.create({
        session_id: 's1', depth: 1, summary: 'parent',
        token_count: 1, source_token_count: 1,
        source_ids: ['DOESNOTEXIST00000000000001'], source_type: 'nodes',
        earliest_at: 1, latest_at: 1,
      });
    });
    const { POST } = await import('@/app/api/agents/[agentId]/lcm/doctor/route');
    const res = await POST(
      postReq('http://localhost:3000/api/agents/alpha/lcm/doctor', { apply: false }),
      { params: Promise.resolve({ agentId: 'alpha' }) },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.health).not.toBe('green');
    const orphan = (json.issues as Array<{ code: string; count?: number }>).find((i) => i.code === 'orphan_nodes');
    expect(orphan).toBeDefined();
    expect(orphan!.count).toBeGreaterThan(0);
  });

  it('apply=false returns no backup and no cleanup field', async () => {
    writeAgent('alpha');
    await seedLcmDb('alpha', ({ dag }) => {
      dag.create({
        session_id: 's1', depth: 1, summary: 'p',
        token_count: 1, source_token_count: 1,
        source_ids: ['DOESNOTEXIST00000000000001'], source_type: 'nodes',
        earliest_at: 1, latest_at: 1,
      });
    });

    const { POST } = await import('@/app/api/agents/[agentId]/lcm/doctor/route');
    const res = await POST(
      postReq('http://localhost:3000/api/agents/alpha/lcm/doctor', { apply: false }),
      { params: Promise.resolve({ agentId: 'alpha' }) },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.cleanup).toBeUndefined();

    // No backup file written
    const backupsDir = join(dataDir, 'lcm', 'lcm-backups');
    expect(existsSync(backupsDir) ? readdirSync(backupsDir) : []).toEqual([]);
  });

  it('apply=true without confirm=true returns 400 confirm_required', async () => {
    writeAgent('alpha');
    await seedLcmDb('alpha', ({ store }) => {
      store.append({ session_id: 's1', source: 'cli', role: 'user', content: 'a', ts: 1 });
    });

    const { POST } = await import('@/app/api/agents/[agentId]/lcm/doctor/route');
    const res = await POST(
      postReq('http://localhost:3000/api/agents/alpha/lcm/doctor', { apply: true }),
      { params: Promise.resolve({ agentId: 'alpha' }) },
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('confirm_required');

    // No backup file created
    const backupsDir = join(dataDir, 'lcm', 'lcm-backups');
    expect(existsSync(backupsDir) ? readdirSync(backupsDir) : []).toEqual([]);
  });

  it('apply=true & confirm=true: creates a backup + cleans up + returns cleanup info', async () => {
    writeAgent('alpha');
    await seedLcmDb('alpha', ({ store, dag }) => {
      store.append({ session_id: 's1', source: 'cli', role: 'user', content: 'a', ts: 1 });
      // Force FTS desync so cleanup actually runs a rebuild action
      dag.create({
        session_id: 's1', depth: 1, summary: 'p',
        token_count: 1, source_token_count: 1,
        source_ids: ['DOESNOTEXIST00000000000001'], source_type: 'nodes',
        earliest_at: 1, latest_at: 1,
      });
    });

    const { POST } = await import('@/app/api/agents/[agentId]/lcm/doctor/route');
    const res = await POST(
      postReq('http://localhost:3000/api/agents/alpha/lcm/doctor', { apply: true, confirm: true }),
      { params: Promise.resolve({ agentId: 'alpha' }) },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.cleanup).toBeDefined();
    expect(typeof json.cleanup.backupPath).toBe('string');
    expect(json.cleanup.backupPath).toContain(join('lcm', 'lcm-backups'));
    expect(existsSync(json.cleanup.backupPath)).toBe(true);
    expect(Array.isArray(json.cleanup.actions)).toBe(true);
  });

  it('subsequent health check after cleanup is green (mutation effective)', async () => {
    writeAgent('alpha');
    await seedLcmDb('alpha', ({ store }) => {
      store.append({ session_id: 's1', source: 'cli', role: 'user', content: 'a', ts: 1 });
      // Manually desync FTS (simulates corruption)
      // We re-open writable to do this — but seedLcmDb closes the db, so do it
      // via a separate connection.
    });
    // Manually corrupt FTS via a writable connection
    const dbPath = join(lcmDbDir, 'alpha.sqlite');
    const wdb = new Database(dbPath);
    wdb.prepare(`INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', 1, 'a')`).run();
    wdb.close();

    const { POST } = await import('@/app/api/agents/[agentId]/lcm/doctor/route');

    // Pre-cleanup: should detect FTS out-of-sync (yellow or red)
    const preRes = await POST(
      postReq('http://localhost:3000/api/agents/alpha/lcm/doctor', { apply: false }),
      { params: Promise.resolve({ agentId: 'alpha' }) },
    );
    const preJson = await preRes.json();
    expect(preJson.health).not.toBe('green');

    // Apply cleanup
    const fixRes = await POST(
      postReq('http://localhost:3000/api/agents/alpha/lcm/doctor', { apply: true, confirm: true }),
      { params: Promise.resolve({ agentId: 'alpha' }) },
    );
    expect(fixRes.status).toBe(200);

    // Post-cleanup: should be green
    const postRes = await POST(
      postReq('http://localhost:3000/api/agents/alpha/lcm/doctor', { apply: false }),
      { params: Promise.resolve({ agentId: 'alpha' }) },
    );
    const postJson = await postRes.json();
    expect(postJson.health).toBe('green');
  });
});
