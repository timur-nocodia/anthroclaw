#!/usr/bin/env tsx

import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { logger } from '../logger.js';
import { LearningStore } from '../learning/store.js';
import { MemoryStore } from '../memory/store.js';
import { metrics } from '../metrics/collector.js';
import { applyMemoryCandidateAction } from '../learning/memory-applier.js';
import { applySkillAction } from '../learning/skill-applier.js';
import { loadAgentYml } from '../config/loader.js';
import type { LearningActionRecord } from '../learning/types.js';

interface CliIO {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

interface ParsedArgs {
  command?: string;
  positional: string[];
  dataDir: string;
  agentsDir: string;
  agentId?: string;
  status?: string;
  reason?: string;
}

export async function runLearningCli(argv: string[], io: CliIO = defaultIO): Promise<number> {
  const args = parseArgs(argv);
  if (!args.command || args.command === 'help' || args.command === '--help') {
    io.stdout(helpText());
    return 0;
  }

  const store = new LearningStore(join(resolve(args.dataDir), 'learning.sqlite'));
  try {
    switch (args.command) {
      case 'list':
        return commandList(store, args, io);
      case 'show':
        return commandShow(store, args, io);
      case 'approve':
        return commandTransition(store, args, io, 'approved');
      case 'reject':
        return commandTransition(store, args, io, 'rejected');
      case 'apply':
        return commandApply(store, args, io);
      default:
        io.stderr(`Unknown command: ${args.command}`);
        io.stderr(helpText());
        return 1;
    }
  } finally {
    store.close();
  }
}

function commandList(store: LearningStore, args: ParsedArgs, io: CliIO): number {
  const actions = store.listActions({
    agentId: args.agentId,
    status: isActionStatus(args.status) ? args.status : undefined,
    limit: 200,
  });
  if (actions.length === 0) {
    io.stdout('No learning actions found.');
    return 0;
  }
  for (const action of actions) {
    io.stdout([
      action.id,
      action.status,
      action.actionType,
      `agent=${action.agentId}`,
      action.title ? `title=${JSON.stringify(action.title)}` : undefined,
    ].filter(Boolean).join('  '));
  }
  return 0;
}

function commandShow(store: LearningStore, args: ParsedArgs, io: CliIO): number {
  const actionId = args.positional[0];
  if (!actionId) return usageError(io, 'show requires <actionId>');
  const action = store.getAction(actionId);
  if (!action) return notFound(io, actionId);
  io.stdout(formatActionDetails(action));
  return 0;
}

function commandTransition(
  store: LearningStore,
  args: ParsedArgs,
  io: CliIO,
  status: 'approved' | 'rejected',
): number {
  const actionId = args.positional[0];
  if (!actionId) return usageError(io, `${status === 'approved' ? 'approve' : 'reject'} requires <actionId>`);
  const action = store.getAction(actionId);
  if (!action) return notFound(io, actionId);
  store.updateActionStatus(actionId, status, {
    updatedAt: Date.now(),
    error: status === 'rejected' ? args.reason : undefined,
  });
  if (status === 'rejected') {
    metrics.increment('learning_actions_rejected');
  }
  logger.info({ actionId, status }, 'Learning action status updated');
  io.stdout(`${status}: ${actionId}`);
  return 0;
}

function commandApply(store: LearningStore, args: ParsedArgs, io: CliIO): number {
  const actionId = args.positional[0];
  if (!actionId) return usageError(io, 'apply requires <actionId>');
  const action = store.getAction(actionId);
  if (!action) return notFound(io, actionId);
  if (action.status !== 'approved') {
    io.stderr(`Action ${actionId} must be approved before apply (current: ${action.status}).`);
    return 1;
  }

  const agentDir = resolve(args.agentsDir, action.agentId);
  const agentYmlPath = join(agentDir, 'agent.yml');
  if (!existsSync(agentYmlPath)) {
    io.stderr(`Agent config not found: ${agentYmlPath}`);
    return 1;
  }
  const config = loadAgentYml(agentDir);

  if (action.actionType === 'memory_candidate') {
    const memoryDbDir = join(resolve(args.dataDir), 'memory-db');
    mkdirSync(memoryDbDir, { recursive: true });
    const memoryStore = new MemoryStore(join(memoryDbDir, `${action.agentId}.sqlite`));
    try {
      const result = applyMemoryCandidateAction({
        memoryStore,
        action,
        safetyProfile: config.safety_profile,
        mode: config.learning.mode,
        agentId: action.agentId,
        reviewStatusOverride: 'approved',
      });
      store.updateActionStatus(action.id, 'applied', { appliedAt: Date.now() });
      io.stdout(`applied memory: ${result.entry.path}`);
      return 0;
    } finally {
      memoryStore.close();
    }
  }

  if (action.actionType === 'skill_patch' || action.actionType === 'skill_create' || action.actionType === 'skill_update_full') {
    const result = applySkillAction({
      workspacePath: agentDir,
      learningStore: store,
      action,
      safetyProfile: config.safety_profile,
      mode: config.learning.mode,
      agentId: action.agentId,
      autoApply: false,
    });
    io.stdout(`applied skill: ${result.skillName} ${result.skillPath}`);
    return 0;
  }

  if (action.actionType === 'none') {
    store.updateActionStatus(action.id, 'applied', { appliedAt: Date.now() });
    io.stdout(`applied none: ${action.id}`);
    return 0;
  }

  io.stderr(`Unsupported action type: ${action.actionType}`);
  return 1;
}

function formatActionDetails(action: LearningActionRecord): string {
  const lines = [
    `id: ${action.id}`,
    `status: ${action.status}`,
    `type: ${action.actionType}`,
    `agent: ${action.agentId}`,
    `review: ${action.reviewId}`,
    `title: ${action.title}`,
    `rationale: ${action.rationale}`,
  ];
  if (action.actionType === 'memory_candidate') {
    lines.push('', 'memory:', String(action.payload.text ?? ''));
  }
  if (action.actionType === 'skill_patch') {
    lines.push('', 'skill patch:', '--- oldText ---', String(action.payload.oldText ?? ''), '--- newText ---', String(action.payload.newText ?? ''));
  } else if (action.actionType === 'skill_create' || action.actionType === 'skill_update_full') {
    lines.push('', 'skill body:', String(action.payload.body ?? ''));
  }
  lines.push('', 'payload:', JSON.stringify(action.payload, null, 2));
  return lines.join('\n');
}

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const out: ParsedArgs = {
    command: undefined,
    positional,
    dataDir: 'data',
    agentsDir: 'agents',
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--data-dir':
        out.dataDir = argv[++i] ?? out.dataDir;
        break;
      case '--agents-dir':
        out.agentsDir = argv[++i] ?? out.agentsDir;
        break;
      case '--status':
        out.status = argv[++i];
        break;
      case '--agent':
        out.agentId = argv[++i];
        break;
      case '--reason':
        out.reason = argv[++i];
        break;
      default:
        if (!out.command) out.command = arg;
        else positional.push(arg);
    }
  }
  return out;
}

function isActionStatus(value: string | undefined): value is 'proposed' | 'approved' | 'rejected' | 'applied' | 'failed' {
  return value === 'proposed' || value === 'approved' || value === 'rejected' || value === 'applied' || value === 'failed';
}

function usageError(io: CliIO, message: string): number {
  io.stderr(message);
  io.stderr(helpText());
  return 1;
}

function notFound(io: CliIO, actionId: string): number {
  io.stderr(`Learning action not found: ${actionId}`);
  return 1;
}

function helpText(): string {
  return [
    'Usage: pnpm learning <command> [options]',
    '',
    'Commands:',
    '  list [--agent <id>] [--status proposed|approved|rejected|applied|failed]',
    '  show <actionId>',
    '  approve <actionId>',
    '  reject <actionId> [--reason "..."]',
    '  apply <actionId>',
    '',
    'Options:',
    '  --data-dir <dir>    AnthroClaw data directory (default: data)',
    '  --agents-dir <dir>  AnthroClaw agents directory (default: agents)',
    '  --agent <id>        Filter list output by agent id',
  ].join('\n');
}

const defaultIO: CliIO = {
  stdout: (text) => console.log(text),
  stderr: (text) => console.error(text),
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const code = await runLearningCli(process.argv.slice(2));
  process.exitCode = code;
}
