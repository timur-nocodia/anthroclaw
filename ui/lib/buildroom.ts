import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { runBuildroomCli } from '@backend/cli/buildroom.js';
import {
  autoBuildroomRoot,
  loadBuildroomRoomConfig,
  saveBuildroomRoomConfig,
} from '@backend/auto-buildroom/storage/init.js';
import type { BuildroomConfig } from '@backend/auto-buildroom/config/model.js';
import { ValidationError } from '@/lib/agents';

export interface BuildroomApiResult {
  status: number;
  body: unknown;
}

export class BuildroomApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown) {
    super(typeof body === 'object' && body !== null && 'error' in body
      ? String((body as { error?: { message?: unknown } }).error?.message ?? 'Buildroom command failed')
      : 'Buildroom command failed');
    this.name = 'BuildroomApiError';
    this.status = status;
    this.body = body;
  }
}

export async function getBuildroomStatus(): Promise<BuildroomApiResult> {
  return runBuildroomJson(['status', '--json']);
}

export async function initializeBuildroom(opts: {
  roomId?: string;
  operatorId?: string;
} = {}): Promise<BuildroomApiResult> {
  const argv = ['init'];
  if (opts.roomId) argv.push('--room', opts.roomId);
  if (opts.operatorId) argv.push('--operator', opts.operatorId);

  await runBuildroomText(argv);
  return getBuildroomStatus();
}

export async function pauseBuildroom(): Promise<BuildroomApiResult> {
  await runBuildroomText(['pause']);
  return getBuildroomStatus();
}

export async function resumeBuildroom(): Promise<BuildroomApiResult> {
  await runBuildroomText(['resume']);
  return getBuildroomStatus();
}

export async function setBuildroomMode(mode: string): Promise<BuildroomApiResult> {
  await runBuildroomText(['mode', mode]);
  return getBuildroomStatus();
}

export async function setBuildroomKillSwitch(active: boolean): Promise<BuildroomApiResult> {
  await runBuildroomText(['kill-switch', active ? 'on' : 'off']);
  return getBuildroomStatus();
}

export function getBuildroomConfig(): BuildroomApiResult {
  if (!isBuildroomInitialized()) {
    return {
      status: 200,
      body: {
        ok: true,
        initialized: false,
        config: null,
      },
    };
  }

  return {
    status: 200,
    body: {
      ok: true,
      initialized: true,
      config: loadBuildroomRoomConfig(projectRoot()),
    },
  };
}

export function updateBuildroomConfig(patch: unknown): BuildroomApiResult {
  if (!isBuildroomInitialized()) {
    throw new BuildroomApiError(409, {
      ok: false,
      error: {
        code: 'not_initialized',
        message: 'Buildroom is not initialized',
      },
    });
  }
  if (!isRecord(patch)) {
    throw new ValidationError('invalid_body', 'JSON object body is required');
  }

  const config = loadBuildroomRoomConfig(projectRoot());
  const next = applySafeConfigPatch(config, patch);
  saveBuildroomRoomConfig(projectRoot(), next);

  return {
    status: 200,
    body: {
      ok: true,
      initialized: true,
      config: loadBuildroomRoomConfig(projectRoot(), next.roomId),
    },
  };
}

async function runBuildroomJson(argv: string[]): Promise<BuildroomApiResult> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runBuildroomCli(
    withProjectRoot(argv),
    {
      stdout: (text) => out.push(text),
      stderr: (text) => err.push(text),
    },
  );

  const raw = code === 0 ? out[0] : err[0];
  const body = raw ? JSON.parse(raw) as unknown : {
    ok: false,
    error: {
      code: 'empty_response',
      message: 'Buildroom command returned no JSON output',
    },
  };

  if (code !== 0) throw new BuildroomApiError(statusForCliExit(code), body);
  return { status: 200, body };
}

async function runBuildroomText(argv: string[]): Promise<void> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runBuildroomCli(
    withProjectRoot(argv),
    {
      stdout: (text) => out.push(text),
      stderr: (text) => err.push(text),
    },
  );
  if (code !== 0) {
    throw new BuildroomApiError(statusForCliExit(code), {
      ok: false,
      error: {
        code: 'buildroom_command_failed',
        message: err[0] ?? out[0] ?? `Buildroom command failed with exit ${code}`,
      },
    });
  }
}

function withProjectRoot(argv: string[]): string[] {
  return [...argv, '--root', projectRoot()];
}

function projectRoot(): string {
  return resolve(process.cwd(), '..');
}

function isBuildroomInitialized(): boolean {
  return existsSync(resolve(autoBuildroomRoot(projectRoot()), 'buildroom.yml'));
}

function applySafeConfigPatch(config: BuildroomConfig, patch: Record<string, unknown>): BuildroomConfig {
  const next: BuildroomConfig = structuredClone(config);

  if (isRecord(patch.watch)) {
    applyWatchPatch(next, patch.watch);
  }
  if (isRecord(patch.paths)) {
    if ('allowed' in patch.paths) next.paths.allowed = requireStringArray(patch.paths.allowed, 'paths.allowed');
    if ('blocked' in patch.paths) next.paths.blocked = requireStringArray(patch.paths.blocked, 'paths.blocked');
  }
  if (isRecord(patch.execution)) {
    if ('mutationTarget' in patch.execution) {
      const value = patch.execution.mutationTarget;
      if (value !== 'worktree' && value !== 'sandbox' && value !== 'in_place') {
        throw new ValidationError('invalid_mutation_target', 'execution.mutationTarget is invalid');
      }
      next.execution.mutationTarget = value;
    }
    if ('allowInPlaceDocsTests' in patch.execution) {
      next.execution.allowInPlaceDocsTests = requireBoolean(
        patch.execution.allowInPlaceDocsTests,
        'execution.allowInPlaceDocsTests',
      );
    }
  }
  if (isRecord(patch.external) && isRecord(patch.external.readOnlyResearch)) {
    next.external.readOnlyResearch.enabled = requireBoolean(
      patch.external.readOnlyResearch.enabled,
      'external.readOnlyResearch.enabled',
    );
  }
  if (isRecord(patch.budgets)) {
    applyBudgetPatch(next, patch.budgets);
  }
  if ('operators' in patch) {
    next.operators = requireOperators(patch.operators);
  }
  if (isRecord(patch.notifications) && 'routes' in patch.notifications) {
    next.notifications.routes = requireStringArray(patch.notifications.routes, 'notifications.routes');
  }

  return next;
}

function applyWatchPatch(config: BuildroomConfig, watch: Record<string, unknown>): void {
  for (const key of ['repo', 'docs', 'tests', 'sessions', 'external'] as const) {
    if (key in watch) {
      config.watch[key].enabled = requireBoolean(watch[key], `watch.${key}`);
    }
  }
  if ('rawTranscripts' in watch) {
    const enabled = requireBoolean(watch.rawTranscripts, 'watch.rawTranscripts');
    if (enabled) {
      throw new ValidationError(
        'raw_transcripts_not_supported',
        'Raw transcript watching cannot be enabled through the v0.1 UI',
      );
    }
    config.watch.rawTranscripts.enabled = false;
  }
}

function applyBudgetPatch(config: BuildroomConfig, budgets: Record<string, unknown>): void {
  for (const key of [
    'maxIdeasPerDay',
    'maxBuildsPerDay',
    'maxActiveBuilds',
    'maxRuntimeMinutesPerStage',
  ] as const) {
    if (key in budgets) {
      config.budgets[key] = requirePositiveInteger(budgets[key], `budgets.${key}`);
    }
  }
}

function requireOperators(value: unknown): BuildroomConfig['operators'] {
  if (!Array.isArray(value)) throw new ValidationError('invalid_operators', 'operators must be an array');
  return value.map((operator, index) => {
    if (!isRecord(operator)) {
      throw new ValidationError('invalid_operator', `operators.${index} must be an object`);
    }
    return {
      id: requireString(operator.id, `operators.${index}.id`),
      commandRoutes: requireStringArray(operator.commandRoutes, `operators.${index}.commandRoutes`),
      approvalRoutes: requireStringArray(operator.approvalRoutes, `operators.${index}.approvalRoutes`),
    };
  });
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ValidationError('invalid_string', `${path} must be a non-empty string`);
  }
  return value;
}

function requireStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new ValidationError('invalid_string_array', `${path} must be an array of strings`);
  }
  return value;
}

function requireBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') {
    throw new ValidationError('invalid_boolean', `${path} must be a boolean`);
  }
  return value;
}

function requirePositiveInteger(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new ValidationError('invalid_positive_integer', `${path} must be a positive integer`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function statusForCliExit(code: number): number {
  switch (code) {
    case 2:
      return 400;
    case 3:
      return 400;
    case 4:
      return 409;
    case 5:
      return 404;
    case 7:
    case 8:
      return 409;
    default:
      return 500;
  }
}
