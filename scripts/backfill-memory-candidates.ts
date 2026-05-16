#!/usr/bin/env tsx
/**
 * One-shot backfill for post_run_candidate entries that piled up in `pending`
 * before v1.1.7's confidence-gated auto-approve was introduced.
 *
 * For each agent's memory sqlite:
 *  - Find `memory_entries` where source='post_run_candidate' AND review_status='pending'
 *  - Read confidence from provenance_json metadata.confidence (fallback: parse content body)
 *  - If confidence >= threshold → promote to 'approved'
 *  - If confidence <  threshold → leave as pending (or delete with --drop-below)
 *
 * Usage:
 *   tsx scripts/backfill-memory-candidates.ts <data-dir> [--threshold=0.6] [--drop-below] [--dry-run] [--agent=<id>]
 */
import Database from 'better-sqlite3';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

interface CliArgs {
  dataDir: string;
  threshold: number;
  dropBelow: boolean;
  dryRun: boolean;
  agentFilter?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const positional = argv.filter((a) => !a.startsWith('--'));
  const flags = argv.filter((a) => a.startsWith('--'));
  const dataDir = positional[0];
  if (!dataDir) {
    console.error('Usage: tsx scripts/backfill-memory-candidates.ts <data-dir> [--threshold=0.6] [--drop-below] [--dry-run] [--agent=<id>]');
    process.exit(2);
  }
  const flagMap = new Map<string, string | true>();
  for (const f of flags) {
    const [k, v] = f.replace(/^--/, '').split('=');
    flagMap.set(k, v ?? true);
  }
  const thresholdRaw = flagMap.get('threshold');
  const threshold = typeof thresholdRaw === 'string' ? Number(thresholdRaw) : 0.6;
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    console.error(`Invalid --threshold=${thresholdRaw}, must be a number in [0,1]`);
    process.exit(2);
  }
  return {
    dataDir,
    threshold,
    dropBelow: Boolean(flagMap.get('drop-below')),
    dryRun: Boolean(flagMap.get('dry-run')),
    agentFilter: typeof flagMap.get('agent') === 'string' ? (flagMap.get('agent') as string) : undefined,
  };
}

interface CandidateRow {
  id: string;
  path: string;
  provenance_json: string;
  rowid: number;
}

function readConfidenceFromProvenance(json: string): number | null {
  try {
    const obj = JSON.parse(json) as { metadata?: { confidence?: unknown } };
    const c = obj?.metadata?.confidence;
    if (typeof c === 'number' && Number.isFinite(c)) return c;
  } catch {
    // fall through
  }
  return null;
}

function readConfidenceFromContent(db: Database.Database, entryPath: string): number | null {
  const row = db.prepare('SELECT text FROM chunks WHERE path = ? LIMIT 1').get(entryPath) as { text?: string } | undefined;
  if (!row?.text) return null;
  const match = /confidence:\s*([0-9]*\.?[0-9]+)/i.exec(row.text);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

interface AgentResult {
  agentId: string;
  scanned: number;
  promoted: number;
  dropped: number;
  keptPending: number;
  noConfidence: number;
}

function processDb(dbPath: string, agentId: string, args: CliArgs): AgentResult {
  const db = new Database(dbPath);
  const result: AgentResult = {
    agentId,
    scanned: 0,
    promoted: 0,
    dropped: 0,
    keptPending: 0,
    noConfidence: 0,
  };

  const rows = db.prepare(`
    SELECT id, path, provenance_json
    FROM memory_entries
    WHERE source = 'post_run_candidate' AND review_status = 'pending'
  `).all() as CandidateRow[];

  result.scanned = rows.length;
  if (rows.length === 0) {
    db.close();
    return result;
  }

  const promote = db.prepare(`
    UPDATE memory_entries SET review_status = 'approved', updated_at = ?
    WHERE id = ?
  `);
  const deleteEntry = db.prepare('DELETE FROM memory_entries WHERE id = ?');
  const deleteChunks = db.prepare('DELETE FROM chunks WHERE path = ?');

  const txn = db.transaction(() => {
    for (const row of rows) {
      const confidence = readConfidenceFromProvenance(row.provenance_json)
        ?? readConfidenceFromContent(db, row.path);

      if (confidence === null) {
        result.noConfidence += 1;
        continue;
      }

      if (confidence >= args.threshold) {
        if (!args.dryRun) promote.run(Date.now(), row.id);
        result.promoted += 1;
      } else if (args.dropBelow) {
        if (!args.dryRun) {
          deleteChunks.run(row.path);
          deleteEntry.run(row.id);
        }
        result.dropped += 1;
      } else {
        result.keptPending += 1;
      }
    }
  });
  txn();
  db.close();
  return result;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const memDir = join(args.dataDir, 'memory-db');
  let files: string[];
  try {
    files = readdirSync(memDir).filter((f) => f.endsWith('.sqlite'));
  } catch (err) {
    console.error(`Cannot read ${memDir}:`, err);
    process.exit(1);
  }

  console.log(`Backfill post_run_candidate (threshold=${args.threshold}, dropBelow=${args.dropBelow}, dryRun=${args.dryRun})`);
  console.log(`Scanning ${files.length} db files in ${memDir}\n`);

  const results: AgentResult[] = [];
  for (const file of files) {
    const agentId = file.replace(/\.sqlite$/, '');
    if (args.agentFilter && agentId !== args.agentFilter) continue;
    const dbPath = join(memDir, file);
    try {
      statSync(dbPath);
    } catch {
      continue;
    }
    const r = processDb(dbPath, agentId, args);
    results.push(r);
    console.log(
      `  ${agentId.padEnd(25)} scanned=${r.scanned} promoted=${r.promoted} dropped=${r.dropped} keptPending=${r.keptPending} noConfidence=${r.noConfidence}`,
    );
  }

  const total = results.reduce(
    (acc, r) => ({
      scanned: acc.scanned + r.scanned,
      promoted: acc.promoted + r.promoted,
      dropped: acc.dropped + r.dropped,
      keptPending: acc.keptPending + r.keptPending,
      noConfidence: acc.noConfidence + r.noConfidence,
    }),
    { scanned: 0, promoted: 0, dropped: 0, keptPending: 0, noConfidence: 0 },
  );

  console.log('\nTotal:', total);
  if (args.dryRun) console.log('(dry-run — no changes written)');
}

main();
