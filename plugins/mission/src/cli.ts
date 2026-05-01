#!/usr/bin/env tsx

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { bootstrap } from './db/bootstrap.js';
import {
  MissionStore,
  type MissionMode,
  type MissionPhase,
  type MissionSnapshot,
} from './store.js';

interface CliIO {
  stdout(text: string): void;
  stderr(text: string): void;
}

interface ParsedArgs {
  command?: string;
  positional: string[];
  dataDir: string;
  agentId?: string;
  title?: string;
  goal?: string;
  mode?: string;
  phase?: string;
  state?: string;
  reason?: string;
  missionId?: string;
  json: boolean;
  nextActions: string[];
}

interface OpenedStore {
  db: Database.Database;
  store: MissionStore;
}

const MODES = new Set<MissionMode>(['lightweight', 'lifecycle', 'operations', 'custom']);
const PHASES = new Set<MissionPhase>(['define', 'design', 'build', 'verify', 'ship']);

export async function runMissionCli(argv: string[], io: CliIO = defaultIO): Promise<number> {
  const args = parseArgs(argv);
  if (!args.command || args.command === 'help' || args.command === '--help') {
    io.stdout(helpText());
    return 0;
  }

  try {
    switch (args.command) {
      case 'status':
        return withStore(args, io, ({ store }) => commandStatus(store, args, io));
      case 'create':
        return withStore(args, io, ({ store }) => commandCreate(store, args, io));
      case 'archive':
        return withStore(args, io, ({ store }) => commandArchive(store, args, io));
      case 'export':
        return withStore(args, io, ({ store }) => commandExport(store, args, io));
      default:
        io.stderr(`Unknown command: ${args.command}`);
        io.stderr(helpText());
        return 1;
    }
  } catch (err) {
    io.stderr(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

function withStore(args: ParsedArgs, io: CliIO, fn: (opened: OpenedStore) => number): number {
  if (!args.agentId) return usageError(io, `${args.command} requires --agent <id>`);
  const dbDir = join(resolve(args.dataDir), 'mission', 'mission-state-db');
  mkdirSync(dbDir, { recursive: true });
  const db = new Database(join(dbDir, `${args.agentId}.sqlite`));
  try {
    bootstrap(db);
    return fn({ db, store: new MissionStore(db) });
  } finally {
    db.close();
  }
}

function commandStatus(store: MissionStore, args: ParsedArgs, io: CliIO): number {
  const snapshot = store.getActiveMission(args.agentId!);
  if (args.json) {
    io.stdout(JSON.stringify(snapshot ? snapshotToJson(snapshot) : { active: false }, null, 2));
    return 0;
  }
  if (!snapshot) {
    io.stdout(`No active mission for agent ${args.agentId}.`);
    return 0;
  }
  io.stdout(formatStatus(snapshot));
  return 0;
}

function commandCreate(store: MissionStore, args: ParsedArgs, io: CliIO): number {
  if (!args.title) return usageError(io, 'create requires --title <text>');
  if (!args.goal) return usageError(io, 'create requires --goal <text>');
  const mode = parseMode(args.mode);
  const phase = parsePhase(args.phase);
  const snapshot = store.createMission({
    agentId: args.agentId!,
    title: args.title,
    goal: args.goal,
    mode,
    phase,
    currentState: args.state,
    nextActions: args.nextActions,
  });
  if (args.json) io.stdout(JSON.stringify(snapshotToJson(snapshot), null, 2));
  else io.stdout(`Created mission ${snapshot.mission.id} for agent ${args.agentId}.`);
  return 0;
}

function commandArchive(store: MissionStore, args: ParsedArgs, io: CliIO): number {
  const snapshot = store.getActiveMission(args.agentId!);
  if (!snapshot) {
    io.stderr(`No active mission for agent ${args.agentId}.`);
    return 1;
  }
  const archived = store.archiveMission(snapshot.mission.id, args.reason ?? '');
  if (args.json) io.stdout(JSON.stringify(snapshotToJson(archived), null, 2));
  else io.stdout(`Archived mission ${archived.mission.id}.`);
  return 0;
}

function commandExport(store: MissionStore, args: ParsedArgs, io: CliIO): number {
  const snapshot = args.missionId
    ? store.getMissionSnapshot(args.missionId)
    : store.getActiveMission(args.agentId!);
  if (!snapshot) {
    io.stderr(args.missionId
      ? `Mission not found: ${args.missionId}`
      : `No active mission for agent ${args.agentId}.`);
    return 1;
  }
  io.stdout(args.json
    ? JSON.stringify(snapshotToJson(snapshot), null, 2)
    : formatMarkdown(snapshot));
  return 0;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const out: ParsedArgs = {
    command: undefined,
    positional,
    dataDir: 'data',
    json: false,
    nextActions: [],
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--data-dir':
        out.dataDir = argv[++i] ?? out.dataDir;
        break;
      case '--agent':
        out.agentId = argv[++i];
        break;
      case '--title':
        out.title = argv[++i];
        break;
      case '--goal':
        out.goal = argv[++i];
        break;
      case '--mode':
        out.mode = argv[++i];
        break;
      case '--phase':
        out.phase = argv[++i];
        break;
      case '--state':
        out.state = argv[++i];
        break;
      case '--next':
        out.nextActions.push(argv[++i] ?? '');
        break;
      case '--reason':
        out.reason = argv[++i];
        break;
      case '--mission':
        out.missionId = argv[++i];
        break;
      case '--json':
        out.json = true;
        break;
      default:
        if (!out.command) out.command = arg;
        else positional.push(arg);
    }
  }

  out.nextActions = out.nextActions.filter((item) => item.trim().length > 0);
  return out;
}

function parseMode(value: string | undefined): MissionMode {
  if (!value) return 'lightweight';
  if (!MODES.has(value as MissionMode)) {
    throw new Error(`Invalid --mode ${JSON.stringify(value)}. Expected: ${[...MODES].join(', ')}`);
  }
  return value as MissionMode;
}

function parsePhase(value: string | undefined): MissionPhase | undefined {
  if (!value) return undefined;
  if (!PHASES.has(value as MissionPhase)) {
    throw new Error(`Invalid --phase ${JSON.stringify(value)}. Expected: ${[...PHASES].join(', ')}`);
  }
  return value as MissionPhase;
}

function snapshotToJson(snapshot: MissionSnapshot): Record<string, unknown> {
  return {
    active: snapshot.mission.status === 'active',
    mission: {
      id: snapshot.mission.id,
      agent_id: snapshot.mission.agent_id,
      title: snapshot.mission.title,
      goal: snapshot.mission.goal,
      mode: snapshot.mission.mode,
      phase: snapshot.mission.phase,
      status: snapshot.mission.status,
      current_state: snapshot.mission.current_state,
      next_actions: snapshot.nextActions,
      metadata: snapshot.metadata,
      created_at: snapshot.mission.created_at,
      updated_at: snapshot.mission.updated_at,
      archived_at: snapshot.mission.archived_at,
    },
    objectives: snapshot.objectives,
    decisions: snapshot.decisions,
    recent_handoffs: snapshot.recentHandoffs,
    recent_events: snapshot.recentEvents,
  };
}

function formatStatus(snapshot: MissionSnapshot): string {
  return [
    `${snapshot.mission.title} (${snapshot.mission.id})`,
    `Agent: ${snapshot.mission.agent_id}`,
    `Goal: ${snapshot.mission.goal}`,
    `Mode: ${snapshot.mission.mode}`,
    `Phase: ${snapshot.mission.phase}`,
    `Status: ${snapshot.mission.status}`,
    '',
    'Current State:',
    snapshot.mission.current_state || '- not set',
    '',
    'Next Actions:',
    formatList(snapshot.nextActions),
  ].join('\n');
}

function formatMarkdown(snapshot: MissionSnapshot): string {
  return [
    `# ${snapshot.mission.title}`,
    '',
    `Mission ID: ${snapshot.mission.id}`,
    `Agent: ${snapshot.mission.agent_id}`,
    `Goal: ${snapshot.mission.goal}`,
    `Mode: ${snapshot.mission.mode}`,
    `Phase: ${snapshot.mission.phase}`,
    `Status: ${snapshot.mission.status}`,
    '',
    '## Current State',
    snapshot.mission.current_state || '- not set',
    '',
    '## Next Actions',
    formatList(snapshot.nextActions),
    '',
    '## Objectives',
    formatList(snapshot.objectives.map((objective) => {
      const rationale = objective.rationale ? ` - ${objective.rationale}` : '';
      return `[${objective.status}] ${objective.content}${rationale}`;
    })),
    '',
    '## Decisions',
    formatList(snapshot.decisions.map((decision) => {
      const outcome = decision.outcome ? ` (${decision.outcome})` : '';
      return `[${decision.status}] ${decision.decision} - ${decision.rationale}${outcome}`;
    })),
    '',
    '## Recent Handoffs',
    formatList(snapshot.recentHandoffs.map((handoff) => {
      const session = handoff.session_key ? ` [${handoff.session_key}]` : '';
      const next = handoff.nextActions.length > 0 ? ` Next: ${handoff.nextActions.join('; ')}` : '';
      return `${handoff.summary}${session}${next}`;
    })),
  ].join('\n');
}

function formatList(items: string[]): string {
  if (items.length === 0) return '- none';
  return items.map((item) => `- ${item}`).join('\n');
}

function usageError(io: CliIO, message: string): number {
  io.stderr(message);
  io.stderr(helpText());
  return 1;
}

function helpText(): string {
  return [
    'Usage: pnpm mission <command> [options]',
    '',
    'Commands:',
    '  status --agent <id> [--json]',
    '  create --agent <id> --title <text> --goal <text> [--mode lightweight|lifecycle|operations|custom] [--phase define|design|build|verify|ship] [--state <text>] [--next <text>] [--json]',
    '  archive --agent <id> [--reason <text>] [--json]',
    '  export --agent <id> [--mission <id>] [--json]',
    '',
    'Options:',
    '  --data-dir <dir>  AnthroClaw data directory (default: data)',
    '  --agent <id>      Agent id',
    '  --json            Print machine-readable JSON',
  ].join('\n');
}

const defaultIO: CliIO = {
  stdout: (text) => console.log(text),
  stderr: (text) => console.error(text),
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const code = await runMissionCli(process.argv.slice(2));
  process.exitCode = code;
}
