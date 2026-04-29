/**
 * POST /api/agents/[agentId]/lcm/doctor
 *
 * Plan 3 Task C1 — health check + double-gated cleanup for LCM.
 *
 * Body:
 *   { apply: boolean, confirm?: boolean }
 *
 * Read-only mode (`apply: false`): runs integrity / FTS-sync / orphan / lineage
 * checks against the read-only LCM SQLite snapshot.
 *
 * Mutating mode (`apply: true && confirm: true`): opens a writable handle,
 * snapshots the DB to `data/lcm-db/backups/<agentId>-<ts>.sqlite` BEFORE any
 * mutation, then deletes orphan node references and rebuilds the FTS shadows
 * if they were out of sync.
 *
 * `apply: true` without `confirm: true` → 400 confirm_required.
 *
 * Mirrors the lcm_doctor MCP tool's semantics but bypasses its rate limiter
 * (operator UI is not subject to per-turn limits) and returns structured JSON
 * instead of stringified text content.
 */

import { NextRequest, NextResponse } from 'next/server';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import Database from 'better-sqlite3';
import { withAuth } from '@/lib/route-handler';
import { getAgentConfig } from '@/lib/agents';
import { openLcmReadOnly, lcmDbPath, SummaryDAG } from '@/lib/lcm';

type Severity = 'info' | 'warning' | 'error';
type Health = 'green' | 'yellow' | 'red';

interface Issue {
  severity: Severity;
  code: string;
  message: string;
  count?: number;
}

interface DoctorReport {
  agentId: string;
  health: Health;
  issues: Issue[];
  cleanup?: {
    backupPath: string;
    actions: string[];
  };
}

function backupsDir(): string {
  return resolve(process.cwd(), '..', 'data', 'lcm-db', 'backups');
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function classifyHealth(issues: Issue[]): Health {
  if (issues.some((i) => i.severity === 'error')) return 'red';
  if (issues.some((i) => i.severity === 'warning')) return 'yellow';
  return 'green';
}

interface CheckOutcome {
  issues: Issue[];
  /** Surfaces facts the cleanup branch may need without re-running queries. */
  orphanIds: string[];
  ftsOutOfSync: boolean;
  integrityOk: boolean;
}

function runChecks(db: Database.Database): CheckOutcome {
  const issues: Issue[] = [];
  const dag = new SummaryDAG(db);

  // 1. integrity_check
  const integrityRow = db.prepare('PRAGMA integrity_check').get() as
    | { integrity_check: string }
    | undefined;
  const integrityValue = integrityRow?.integrity_check ?? 'unknown';
  const integrityOk = integrityValue === 'ok';
  if (!integrityOk) {
    issues.push({
      severity: 'error',
      code: 'integrity_check_failed',
      message: `SQLite integrity_check returned: ${integrityValue}`,
    });
  }

  // 2. FTS sync
  const fts = dag.verifyFtsSync();
  const ftsOutOfSync = !fts.messagesOk || !fts.nodesOk;
  if (ftsOutOfSync) {
    issues.push({
      severity: 'warning',
      code: 'fts_out_of_sync',
      message:
        `FTS shadow tables out of sync: messages ${fts.msgCount} vs ${fts.msgFtsCount}, ` +
        `nodes ${fts.nodeCount} vs ${fts.nodeFtsCount}`,
    });
  }

  // 3. Orphan node references (parent points at a missing child id)
  const orphanIds = dag.findOrphans();
  if (orphanIds.length > 0) {
    issues.push({
      severity: 'warning',
      code: 'orphan_nodes',
      message: `${orphanIds.length} DAG node reference(s) point to non-existent node_ids`,
      count: orphanIds.length,
    });
  }

  // 4. Source-lineage hygiene (messages-typed node referencing missing store_id)
  const broken = dag.findBrokenSourceLineages();
  if (broken.length > 0) {
    issues.push({
      severity: 'warning',
      code: 'source_lineage_broken',
      message: `${broken.length} messages-typed node(s) reference missing store_ids`,
      count: broken.length,
    });
  }

  return { issues, orphanIds, ftsOutOfSync, integrityOk };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  return withAuth(async () => {
    const { agentId } = await params;
    // 404 if the agent doesn't exist.
    getAgentConfig(agentId);

    let body: { apply?: unknown; confirm?: unknown };
    try {
      body = (await req.json()) as { apply?: unknown; confirm?: unknown };
    } catch {
      body = {};
    }

    const apply = body.apply === true;
    const confirm = body.confirm === true;

    if (apply && !confirm) {
      return NextResponse.json(
        {
          error: 'confirm_required',
          message: 'apply: true requires confirm: true to perform mutations',
        },
        { status: 400 },
      );
    }

    // Read-only health check path — used both for `apply: false` calls and as
    // the first phase of the mutating path to discover what needs cleaning.
    const dbPath = lcmDbPath(agentId);
    if (!existsSync(dbPath)) {
      // No LCM data → green by definition.
      const report: DoctorReport = { agentId, health: 'green', issues: [] };
      return NextResponse.json(report);
    }

    if (!apply) {
      const handle = openLcmReadOnly(agentId);
      if (!handle) {
        const report: DoctorReport = { agentId, health: 'green', issues: [] };
        return NextResponse.json(report);
      }
      try {
        const { issues } = runChecks(handle.db);
        const report: DoctorReport = {
          agentId,
          health: classifyHealth(issues),
          issues,
        };
        return NextResponse.json(report);
      } finally {
        handle.db.close();
      }
    }

    // Mutating path: open writable, backup first, then clean.
    let db: Database.Database;
    try {
      db = new Database(dbPath, { readonly: false, fileMustExist: true });
    } catch {
      // File present but unopenable — surface as green/empty (caller can re-run).
      const report: DoctorReport = { agentId, health: 'green', issues: [] };
      return NextResponse.json(report);
    }

    try {
      // Run the checks first so we know what to mutate (and so we can return
      // them in the response even when the cleanup ends up being a no-op).
      let checks: CheckOutcome;
      try {
        checks = runChecks(db);
      } catch (err) {
        // Schema not bootstrapped, etc. Treat as green/empty.
        const message = err instanceof Error ? err.message : String(err);
        const report: DoctorReport = {
          agentId,
          health: 'green',
          issues: [{ severity: 'info', code: 'no_lcm_data', message }],
        };
        return NextResponse.json(report);
      }

      // Backup the file BEFORE mutating, regardless of whether anything needs
      // changing. Operators can audit a frozen snapshot post-doctor.
      const dir = backupsDir();
      mkdirSync(dir, { recursive: true });
      const backupPath = join(dir, `${agentId}-${timestamp()}.sqlite`);
      await db.backup(backupPath);

      const actions: string[] = [];
      const dag = new SummaryDAG(db);

      if (checks.orphanIds.length > 0) {
        const removed = dag.deleteOrphans(checks.orphanIds);
        actions.push(`delete_orphans: removed ${removed} row(s)`);
      }

      if (checks.ftsOutOfSync || !checks.integrityOk) {
        dag.rebuildFts();
        actions.push('rebuild_fts: messages_fts + nodes_fts');
      }

      const report: DoctorReport = {
        agentId,
        health: classifyHealth(checks.issues),
        issues: checks.issues,
        cleanup: { backupPath, actions },
      };
      return NextResponse.json(report);
    } finally {
      try {
        db.close();
      } catch {
        /* ignore double-close */
      }
    }
  });
}
