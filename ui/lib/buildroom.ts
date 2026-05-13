import { resolve } from 'node:path';
import { runBuildroomCli } from '@backend/cli/buildroom.js';

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
