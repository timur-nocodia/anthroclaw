/**
 * @e2e — Plan 3 Task B5: full-stack lossless drill via the LCM sessions API surface.
 *
 * Closes Phase B by exercising the entire UI HTTP layer (B1 list + detail,
 * B2 grep) against a REAL LCM SQLite seeded from the plugin's compress
 * pipeline. The @lossless analog of plugins/lcm T23, but executed through
 * the route handlers — catches drift between UI projection and engine
 * invariants that unit tests in isolation can't see.
 *
 * What this test catches that B1 + B2 unit tests + T23 do not:
 *   - The route's `children` projection (mapping store_ids → message rows
 *     for D0 nodes, mapping child node previews for D1+) really preserves
 *     content/role/ts byte-exact across a multi-pass compress.
 *   - The drill path (D2 → D1 → D0 → message) actually works through three
 *     successive HTTP calls — i.e. each detail call produces children whose
 *     IDs are valid handles for the next call.
 *   - The B2 grep route's message-hits route through the same store the
 *     B1 detail route reads — no schema/index drift.
 *
 * Pattern lifted from lcm-dag.test.ts (B1 fixture seeding) and
 * lossless.test.ts (T23 compress config + mock subagent).
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { NextRequest } from 'next/server';

// ─── Auth bypass — same pattern as lcm-dag.test.ts ───────────────────
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../..');

interface SeededMessage {
  store_id: number;
  content: string;
  role: 'user' | 'assistant';
  ts: number;
  source: string;
}

describe('@e2e: LCM sessions surface (full stack: seed → API → drill → byte-exact)', () => {
  const SESSION = 'test-agent:cli:dm:user-1';
  const AGENT_ID = 'test-agent';

  let tmpRoot: string;
  let lcmDbDir: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'p3-b5-'));
    const fakeUi = join(tmpRoot, 'ui');
    mkdirSync(fakeUi, { recursive: true });
    lcmDbDir = join(tmpRoot, 'data', 'lcm-db');
    mkdirSync(lcmDbDir, { recursive: true });

    const agentDir = join(tmpRoot, 'agents', AGENT_ID);
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      join(agentDir, 'agent.yml'),
      'model: claude-sonnet-4-6\nroutes:\n  - channel: telegram\n    scope: dm\n',
      'utf-8',
    );
    writeFileSync(join(agentDir, 'CLAUDE.md'), '# test\n', 'utf-8');

    // Spy cwd → fakeUi BEFORE route imports (their path constants resolve
    // `process.cwd()/..` at module load time).
    vi.spyOn(process, 'cwd').mockReturnValue(fakeUi);
    vi.resetModules();
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.resetModules();
  });

  /**
   * Seed an LCM SQLite DB at <tmpRoot>/data/lcm-db/<AGENT_ID>.sqlite,
   * then run the engine's compress pipeline so D0/D1/D2 nodes emerge.
   * Returns the seeded messages with their store_ids so the test can
   * assert byte-exact recovery later.
   */
  async function seedLcmDb(messages: Array<{ content: string; role: 'user' | 'assistant'; ts: number; source: string }>): Promise<SeededMessage[]> {
    const { bootstrap } = await import('../../../plugins/lcm/dist/db/bootstrap.js');
    const { MessageStore } = await import('../../../plugins/lcm/dist/store.js');
    const { SummaryDAG } = await import('../../../plugins/lcm/dist/dag.js');
    const { LifecycleManager } = await import('../../../plugins/lcm/dist/lifecycle.js');
    const { LCMEngine } = await import('../../../plugins/lcm/dist/engine.js');

    const dbPath = join(lcmDbDir, `${AGENT_ID}.sqlite`);
    const db = new Database(dbPath);
    bootstrap(db);
    const store = new MessageStore(db);
    const dag = new SummaryDAG(db);
    const lifecycle = new LifecycleManager(db);
    // engine.compress's lifecycle.clearDebt + recordCompactedFrontier need
    // the row to exist (otherwise it warns and skips the bookkeeping).
    lifecycle.initialize(AGENT_ID, SESSION);

    const seeded: SeededMessage[] = [];
    for (const m of messages) {
      const store_id = store.append({
        session_id: SESSION,
        source: m.source,
        role: m.role,
        content: m.content,
        ts: m.ts,
      });
      seeded.push({ store_id, ...m });
    }

    // Same config as T23 — picked so 200 messages emerge as D2 in one pass.
    const stubLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
    const engine = new LCMEngine({
      store,
      dag,
      lifecycle,
      runSubagent: async ({ prompt }: { prompt: string }) => `anchor summary len ${prompt.length}`,
      config: {
        leafChunkTokens: 50,
        condensationFanin: 4,
        freshTailLength: 2,
        assemblyCapTokens: 32_000,
        l3TruncateChars: 2048,
        l2BudgetRatio: 0.5,
        dynamicLeafChunk: false,
        cacheFriendlyCondensation: false,
      },
      logger: stubLogger as never,
    });

    const sysMsg = { role: 'system' as const, content: 'System prompt for B5 e2e test.' };
    const messagesPayload = [
      sysMsg,
      ...messages.map(m => ({ role: m.role, content: m.content, ts: m.ts })),
    ];
    const result = await engine.compress({
      agentId: AGENT_ID,
      sessionKey: SESSION,
      messages: messagesPayload,
      currentTokens: 100_000,
    });
    if (!result.compressionApplied) {
      db.close();
      throw new Error('seed failed: compress did not apply — adjust leafChunkTokens or message count');
    }

    db.close();
    return seeded;
  }

  it('full lossless drill via API: D2 → D1 → D0 → byte-exact original messages', async () => {
    // ── Step 1: Seed 200 messages with markers ──────────────────────────
    const seeded = await seedLcmDb(
      Array.from({ length: 200 }, (_, i) => ({
        content: `MARKER-${i}: ${'x'.repeat(50)}`,
        role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
        ts: 1000 + i,
        source: 'cli',
      })),
    );

    // ── Step 2: B1 list route — verify D0/D1/D2 counts ─────────────────
    const { GET: listGet } = await import('@/app/api/agents/[agentId]/lcm/dag/route');
    const listReq = new NextRequest(
      new URL(`/api/agents/${AGENT_ID}/lcm/dag?session=${encodeURIComponent(SESSION)}`, 'http://localhost:3000'),
    );
    const listRes = await listGet(listReq, { params: Promise.resolve({ agentId: AGENT_ID }) });
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json();

    const d0Count = listBody.countsByDepth[0] ?? 0;
    const d1Count = listBody.countsByDepth[1] ?? 0;
    const d2Count = listBody.countsByDepth[2] ?? 0;
    expect(d0Count, 'expected ≥1 D0 node from 200-msg compress').toBeGreaterThan(0);
    expect(d1Count, 'expected ≥1 D1 node from 200-msg compress').toBeGreaterThan(0);
    expect(d2Count, 'expected ≥1 D2 node from 200-msg compress').toBeGreaterThan(0);
    // totalNodes = sum across all observed depths (engine may emit D3+ if
    // condensation cascades; we treat that as fine and sum dynamically).
    const summedCounts = Object.values(listBody.countsByDepth as Record<string, number>).reduce(
      (a, b) => a + b,
      0,
    );
    expect(listBody.totalNodes).toBe(summedCounts);
    expect(listBody.session).toBe(SESSION);

    const d2Nodes = (listBody.nodes as Array<{ depth: number; node_id: string }>).filter(n => n.depth === 2);
    expect(d2Nodes.length).toBe(d2Count);

    // ── Step 3: B1 detail route — drill D2 → D1 → D0 ──────────────────
    const { GET: detailGet } = await import('@/app/api/agents/[agentId]/lcm/nodes/[nodeId]/route');

    async function fetchNode(nodeId: string): Promise<{
      node_id: string;
      depth: number;
      source_type: 'messages' | 'nodes';
      children: Array<
        | { kind: 'message'; store_id: number; role: string; content: string; ts: number; source: string }
        | { kind: 'node'; node_id: string; depth: number; summary_preview: string; child_count: number }
      >;
    }> {
      const req = new NextRequest(
        new URL(`/api/agents/${AGENT_ID}/lcm/nodes/${nodeId}`, 'http://localhost:3000'),
      );
      const res = await detailGet(req, { params: Promise.resolve({ agentId: AGENT_ID, nodeId }) });
      expect(res.status, `detail GET for ${nodeId} must succeed`).toBe(200);
      return res.json();
    }

    const d2 = await fetchNode(d2Nodes[0].node_id);
    expect(d2.depth).toBe(2);
    expect(d2.source_type).toBe('nodes');
    expect(d2.children.length).toBeGreaterThan(0);
    expect(d2.children.every(c => c.kind === 'node')).toBe(true);

    // Drill the first D1 child
    const firstD1Child = d2.children[0];
    if (firstD1Child.kind !== 'node') throw new Error('unreachable — guarded above');
    expect(firstD1Child.depth).toBe(1);

    const d1 = await fetchNode(firstD1Child.node_id);
    expect(d1.depth).toBe(1);
    expect(d1.source_type).toBe('nodes');
    expect(d1.children.length).toBeGreaterThan(0);
    expect(d1.children.every(c => c.kind === 'node')).toBe(true);

    // Drill the first D0 child
    const firstD0Child = d1.children[0];
    if (firstD0Child.kind !== 'node') throw new Error('unreachable — guarded above');
    expect(firstD0Child.depth).toBe(0);

    const d0 = await fetchNode(firstD0Child.node_id);
    expect(d0.depth).toBe(0);
    expect(d0.source_type).toBe('messages');
    expect(d0.children.length).toBeGreaterThan(0);
    expect(d0.children.every(c => c.kind === 'message')).toBe(true);

    // ── Step 4: Byte-exact verification on D0's leaf messages ─────────
    // Each D0 child must match its original by store_id, content, role, ts.
    for (const m of d0.children) {
      if (m.kind !== 'message') throw new Error('unreachable — guarded above');
      const orig = seeded.find(s => s.store_id === m.store_id);
      expect(
        orig,
        `recovered store_id=${m.store_id} must match an originally seeded message`,
      ).toBeDefined();
      expect(m.content).toBe(orig!.content);
      expect(m.role).toBe(orig!.role);
      expect(m.ts).toBe(orig!.ts);
      expect(m.source).toBe(orig!.source);
    }

    // ── Step 5: Full coverage — walk every D2 → D1 → D0 → messages ────
    // Verifies the API drill path resolves to a non-empty, byte-exact
    // subset of the originally seeded messages — not just one branch.
    const recoveredViaApi = new Map<number, { content: string; role: string; ts: number; source: string }>();
    for (const d2Node of d2Nodes) {
      const d2Detail = await fetchNode(d2Node.node_id);
      for (const d1Pre of d2Detail.children) {
        if (d1Pre.kind !== 'node') continue;
        const d1Detail = await fetchNode(d1Pre.node_id);
        for (const d0Pre of d1Detail.children) {
          if (d0Pre.kind !== 'node') continue;
          const d0Detail = await fetchNode(d0Pre.node_id);
          for (const msg of d0Detail.children) {
            if (msg.kind !== 'message') continue;
            recoveredViaApi.set(msg.store_id, {
              content: msg.content,
              role: msg.role,
              ts: msg.ts,
              source: msg.source,
            });
          }
        }
      }
    }
    // Full drill must recover ≥ 90% of originals (fresh tail + chunking
    // boundaries can leave a handful uncovered, but the bulk must be there).
    expect(
      recoveredViaApi.size,
      'full D2→messages drill must recover most originally seeded messages',
    ).toBeGreaterThan(seeded.length * 0.9);
    for (const [storeId, recovered] of recoveredViaApi) {
      const orig = seeded.find(s => s.store_id === storeId);
      expect(orig, `recovered store_id=${storeId} must match an original`).toBeDefined();
      expect(recovered.content).toBe(orig!.content);
      expect(recovered.role).toBe(orig!.role);
      expect(recovered.ts).toBe(orig!.ts);
      expect(recovered.source).toBe(orig!.source);
    }

    // ── Step 6: B2 grep route returns both message + node hits ────────
    const { GET: grepGet } = await import('@/app/api/agents/[agentId]/lcm/grep/route');
    const grepReq = new NextRequest(
      new URL(
        `/api/agents/${AGENT_ID}/lcm/grep?q=MARKER-100&session=${encodeURIComponent(SESSION)}`,
        'http://localhost:3000',
      ),
    );
    const grepRes = await grepGet(grepReq, { params: Promise.resolve({ agentId: AGENT_ID }) });
    expect(grepRes.status).toBe(200);
    const grepBody = await grepRes.json();

    // The marker is preserved in the immutable message store regardless of
    // compression, so message hits must be present.
    const messageHits = (grepBody.hits as Array<{ kind: string; snippet: string; store_id?: number }>).filter(
      h => h.kind === 'message',
    );
    expect(messageHits.length, 'MARKER-100 must be findable in the message store').toBeGreaterThan(0);
    expect(messageHits[0].snippet).toContain('MARKER-100');

    // The matching message hit must drill to a real seeded store_id.
    const hitStoreId = messageHits[0].store_id;
    expect(hitStoreId).toBeDefined();
    const matchingOriginal = seeded.find(s => s.store_id === hitStoreId);
    expect(matchingOriginal).toBeDefined();
    expect(matchingOriginal!.content).toContain('MARKER-100');

    // The grep response shape is well-formed for both kinds (sanity — even
    // if no node hit comes back for this anchor query, the union type and
    // routing must be consistent).
    expect(grepBody.agentId).toBe(AGENT_ID);
    expect(grepBody.query).toBe('MARKER-100');
    expect(typeof grepBody.totalReturned).toBe('number');
    expect(typeof grepBody.truncated).toBe('boolean');
  }, 30_000);
});
