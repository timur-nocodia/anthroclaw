import 'dotenv/config';
import { runPiAdminConfigGateCli } from './pi-admin-config-gate.js';
import { runPiBuildroomHandoffGateCli } from './pi-buildroom-handoff-gate.js';
import { runPiCronNotificationGateCli } from './pi-cron-notification-gate.js';
import { runPiHonchoLocalGateCli } from './pi-honcho-local-gate.js';
import { runPiLearningProposeGateCli } from './pi-learning-propose-gate.js';
import { runPiLiveNotificationGateCli } from './pi-live-notification-gate.js';
import { runPiLiveSendMediaGateCli } from './pi-live-send-media-gate.js';
import { runPiLiveSendMessageGateCli } from './pi-live-send-message-gate.js';
import { runPiMcpFileTransferGateCli } from './pi-mcp-file-transfer-gate.js';
import { runPiMemoryReadGateCli } from './pi-memory-read-gate.js';
import {
  SIDE_EFFECT_GATE_REGISTRY,
  findSideEffectGate,
  sideEffectGateIds,
  type SideEffectGateId,
} from '../runtime/side-effect-gates/registry.js';

export const PI_LIVE_GATE_IDS = sideEffectGateIds();

export type PiLiveGateId = SideEffectGateId;

interface PiLiveGateArgs {
  describe?: PiLiveGateId;
  gate?: PiLiveGateId;
  rest: string[];
  help: boolean;
  json: boolean;
  list: boolean;
}

interface PiLiveGateDeps {
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
  stderr?: Pick<NodeJS.WriteStream, 'write'>;
  gateRunners?: Partial<Record<PiLiveGateId, (argv: string[], deps?: unknown) => Promise<number>>>;
}

const GATE_RUNNERS: Record<PiLiveGateId, (argv: string[], deps?: unknown) => Promise<number>> = {
  'live-send-message': (argv, deps) => runPiLiveSendMessageGateCli(argv, deps as never),
  'live-send-media': (argv, deps) => runPiLiveSendMediaGateCli(argv, deps as never),
  'live-notification': (argv, deps) => runPiLiveNotificationGateCli(argv, deps as never),
  'cron-notification': (argv, deps) => runPiCronNotificationGateCli(argv, deps as never),
  'buildroom-handoff': (argv, deps) => runPiBuildroomHandoffGateCli(argv, deps as never),
  'admin-config': (argv, deps) => runPiAdminConfigGateCli(argv, deps as never),
  'mcp-file-transfer': (argv, deps) => runPiMcpFileTransferGateCli(argv, deps as never),
  'honcho-local': (argv, deps) => runPiHonchoLocalGateCli(argv, deps as never),
  'learning-propose': (argv, deps) => runPiLearningProposeGateCli(argv, deps as never),
  'memory-read': (argv, deps) => runPiMemoryReadGateCli(argv, deps as never),
};

export async function runPiLiveGateCli(
  argv: string[],
  deps: PiLiveGateDeps = {},
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;

  let args: PiLiveGateArgs;
  try {
    args = parsePiLiveGateArgs(argv);
  } catch (err) {
    stderr.write(`${errorMessage(err)}\n${usage()}\n`);
    return 2;
  }

  if (args.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }
  if (args.list) {
    stdout.write(args.json ? `${JSON.stringify(listPayload(), null, 2)}\n` : `${formatGateList()}\n`);
    return 0;
  }
  if (args.describe) {
    const gate = findSideEffectGate(args.describe);
    if (!gate) {
      stderr.write(`Unknown gate: ${args.describe}\n${usage()}\n`);
      return 2;
    }
    stdout.write(args.json ? `${JSON.stringify(describePayload(gate), null, 2)}\n` : `${formatGateDescription(gate)}\n`);
    return 0;
  }
  if (!args.gate) {
    stderr.write(`--gate is required.\n${usage()}\n`);
    return 2;
  }

  const runner = deps.gateRunners?.[args.gate] ?? GATE_RUNNERS[args.gate];
  return runner(args.rest, deps);
}

export function parsePiLiveGateArgs(argv: string[]): PiLiveGateArgs {
  let describe: PiLiveGateId | undefined;
  const rest: string[] = [];
  let gate: PiLiveGateId | undefined;
  let help = false;
  let json = false;
  let list = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }
    if (arg === '--json') {
      json = true;
      rest.push(arg);
      continue;
    }
    if (arg === '--list') {
      list = true;
      continue;
    }
    if (arg === '--describe') {
      describe = parseGateId(requireValue(argv, ++i, '--describe'));
      continue;
    }
    if (arg.startsWith('--describe=')) {
      describe = parseGateId(arg.slice('--describe='.length));
      continue;
    }
    if (arg === '--gate') {
      gate = parseGateId(requireValue(argv, ++i, '--gate'));
      continue;
    }
    if (arg.startsWith('--gate=')) {
      gate = parseGateId(arg.slice('--gate='.length));
      continue;
    }
    rest.push(arg);
  }

  return { describe, gate, rest, help, json, list };
}

function listPayload() {
  return {
    status: 'ok',
    gates: SIDE_EFFECT_GATE_REGISTRY,
  };
}

function describePayload(gate: NonNullable<ReturnType<typeof findSideEffectGate>>) {
  return {
    status: 'ok',
    gate,
  };
}

function formatGateList(): string {
  return [
    'Pi live gates:',
    ...SIDE_EFFECT_GATE_REGISTRY.map((gate) => [
      `  ${gate.id}`,
      `    action: ${gate.action}`,
      `    risk: ${gate.risk}`,
      `    focused: ${gate.focusedCommand}`,
      `    compatibility: ${gate.compatibilityCommand}`,
    ].join('\n')),
  ].join('\n');
}

function formatGateDescription(gate: NonNullable<ReturnType<typeof findSideEffectGate>>): string {
  return [
    `Pi live gate: ${gate.id}`,
    `  action: ${gate.action}`,
    `  risk: ${gate.risk}`,
    `  focused: ${gate.focusedCommand}`,
    `  compatibility: ${gate.compatibilityCommand}`,
    `  safety: ${gate.execution.safetyMode}`,
    `  approval: ${gate.execution.approval}`,
    `  supportsDryRun: ${gate.execution.supportsDryRun}`,
    `  requiredFlags: ${gate.execution.requiredFlags.join(', ')}`,
    `  optionalFlags: ${gate.execution.optionalFlags.join(', ')}`,
    `  example: pnpm runtime:pi-live-gate -- --gate ${gate.id} ${gate.execution.exampleArgs.join(' ')}`,
  ].join('\n');
}

function parseGateId(value: string): PiLiveGateId {
  if (findSideEffectGate(value)) return value as PiLiveGateId;
  throw new Error(`Unknown gate: ${value}`);
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`);
  return value;
}

function usage(): string {
  return [
    'Usage: pnpm runtime:pi-live-gate -- --gate <gate-id> [gate options]',
    '       pnpm runtime:pi-live-gate -- --list [--json]',
    '       pnpm runtime:pi-live-gate -- --describe <gate-id> [--json]',
    '',
    'Gate ids:',
    ...PI_LIVE_GATE_IDS.map((id) => `  ${id}`),
    '',
    'Examples:',
    '  pnpm runtime:pi-live-gate -- --gate live-send-message --agent-id <id> --peer-id <peer> --dry-run --json',
    '  pnpm runtime:pi-live-gate -- --gate memory-read --agent-id <id> --peer-id <peer> --sender-id <sender> --json --allow-skip',
    '',
    'Pass -h/--help after a focused gate command to see that gate-specific help.',
  ].join('\n');
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPiLiveGateCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      process.stderr.write(`${errorMessage(err)}\n`);
      process.exitCode = 1;
    });
}
