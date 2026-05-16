import 'dotenv/config';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getOverlayPath, loadGlobalConfigWithOverlay } from '../config/overlay.js';
import type { RuntimeEvent } from '../runtime/events.js';
import type { HeadlessRunInput, HeadlessRuntime } from '../runtime/headless.js';
import { resolveHeadlessRuntime } from '../runtime/headless-registry.js';
import { DEFAULT_PI_MODEL_ID } from '../runtime/pi-headless.js';
import type { RuntimeRunHandle } from '../runtime/types.js';

const SMOKE_FILE = 'anthroclaw-pi-smoke.txt';
const BEFORE_TEXT = 'before AnthroClaw Pi smoke\n';
const AFTER_TEXT = 'after AnthroClaw Pi smoke\n';
const EXPECTED_REPLY = 'SMOKE_OK';
const USER_MESSAGE_ID = 'anthroclaw-pi-smoke-user-message';

interface PiWorkspaceSmokeArgs {
  configPath?: string;
  dataDir: string;
  model?: string;
  authPath?: string;
  modelsPath?: string;
  timeoutMs?: number;
  keepWorkspace: boolean;
  allowSkip: boolean;
  json: boolean;
  help: boolean;
}

interface RuntimeWithHandle extends HeadlessRuntime {
  runHandle(
    input: HeadlessRunInput,
    context: { runId: string; sessionId?: string; agentId?: string },
  ): Promise<RuntimeRunHandle<RuntimeEvent>>;
}

interface PiWorkspaceSmokeDeps {
  loadConfig?: typeof loadGlobalConfigWithOverlay;
  resolveRuntime?: () => HeadlessRuntime;
  makeWorkspace?: () => string;
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
  stderr?: Pick<NodeJS.WriteStream, 'write'>;
}

interface SmokeResult {
  status: 'passed' | 'failed' | 'skipped';
  runtime: 'pi';
  workspace: string;
  sessionId?: string;
  text: string;
  dryRun?: {
    canRewind: boolean;
    filesChanged?: string[];
    insertions?: number;
    deletions?: number;
    error?: string;
  };
  restore?: {
    canRewind: boolean;
    filesChanged?: string[];
    insertions?: number;
    deletions?: number;
    error?: string;
  };
  error?: string;
}

export async function runPiWorkspaceSmokeCli(
  argv: string[],
  deps: PiWorkspaceSmokeDeps = {},
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  let args: PiWorkspaceSmokeArgs;

  try {
    args = parsePiWorkspaceSmokeArgs(argv);
  } catch (err) {
    stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    stderr.write(`${usage()}\n`);
    return 2;
  }

  if (args.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  const workspace = deps.makeWorkspace?.() ?? mkdtempSync(join(tmpdir(), 'anthroclaw-pi-workspace-smoke-'));
  let shouldRemoveWorkspace = !args.keepWorkspace;
  try {
    const model = args.model ?? loadConfiguredModel(args, deps.loadConfig) ?? DEFAULT_PI_MODEL_ID;
    const runtime = deps.resolveRuntime?.() ?? resolveHeadlessRuntime('pi', {
      pi: {
        authStoragePath: args.authPath,
        modelsPath: args.modelsPath,
      },
    });
    const result = await runPiWorkspaceSmoke({
      runtime,
      workspace,
      model,
      timeoutMs: args.timeoutMs,
    });
    writeResult(stdout, args.json, result);
    return 0;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const status = args.allowSkip && isSkippableSmokeError(error) ? 'skipped' : 'failed';
    const result: SmokeResult = {
      status,
      runtime: 'pi',
      workspace,
      text: '',
      error,
    };
    writeResult(status === 'failed' ? stderr : stdout, args.json, result);
    if (status === 'skipped') return 0;
    shouldRemoveWorkspace = false;
    return 1;
  } finally {
    if (shouldRemoveWorkspace) {
      rmSync(workspace, { recursive: true, force: true });
    }
  }
}

export async function runPiWorkspaceSmoke(input: {
  runtime: HeadlessRuntime;
  workspace: string;
  model?: string;
  timeoutMs?: number;
}): Promise<SmokeResult> {
  if (!isRuntimeWithHandle(input.runtime)) {
    throw new Error('Pi workspace smoke requires a runtime with runHandle().');
  }

  const workspace = resolve(input.workspace);
  const smokePath = join(workspace, SMOKE_FILE);
  mkdirSync(workspace, { recursive: true });
  writeFileSync(smokePath, BEFORE_TEXT, 'utf8');

  const handle = await input.runtime.runHandle({
    prompt: [
      `Modify ${SMOKE_FILE} in the current working directory so it contains exactly:`,
      AFTER_TEXT.trimEnd(),
      'Do not modify any other files. Reply with SMOKE_OK when done.',
    ].join('\n'),
    cwd: workspace,
    model: input.model,
    timeoutMs: input.timeoutMs,
    purpose: 'pi workspace rewind smoke',
    toolPolicy: {
      mode: 'allow-list',
      tools: ['Read', 'Edit', 'Write'],
      denyMessage: 'Only file read/edit/write tools are allowed for the Pi workspace smoke.',
    },
  }, {
    runId: `pi-workspace-smoke-${Date.now()}`,
    agentId: 'pi-workspace-smoke',
  });

  const partialTextParts: string[] = [];
  const messageTextParts: string[] = [];
  try {
    for await (const event of handle) {
      if (event.type === 'text.delta') {
        if (event.source === 'message') {
          messageTextParts.push(event.text);
        } else {
          partialTextParts.push(event.text);
        }
      }
    }
    assertFile(smokePath, AFTER_TEXT, 'Pi run did not modify the smoke file as expected.');
    const text = (partialTextParts.length > 0 ? partialTextParts : messageTextParts).join('').trim();
    if (text !== EXPECTED_REPLY) {
      throw new Error(`Pi workspace smoke expected reply ${JSON.stringify(EXPECTED_REPLY)}, got ${JSON.stringify(text)}.`);
    }

    const dryRun = await handle.rewindFiles?.(USER_MESSAGE_ID, { dryRun: true });
    if (!dryRun?.canRewind) {
      throw new Error(dryRun?.error ?? 'Pi workspace rewind dry-run failed.');
    }
    assertFile(smokePath, AFTER_TEXT, 'Dry-run changed the smoke file.');

    const restore = await handle.rewindFiles?.(USER_MESSAGE_ID, { dryRun: false });
    if (!restore?.canRewind) {
      throw new Error(restore?.error ?? 'Pi workspace rewind restore failed.');
    }
    assertFile(smokePath, BEFORE_TEXT, 'Pi workspace rewind did not restore the smoke file.');

    return {
      status: 'passed',
      runtime: 'pi',
      workspace,
      sessionId: (handle as { sessionId?: string }).sessionId,
      text,
      dryRun,
      restore,
    };
  } finally {
    handle.close();
  }
}

export function parsePiWorkspaceSmokeArgs(argv: string[]): PiWorkspaceSmokeArgs {
  const args: PiWorkspaceSmokeArgs = {
    dataDir: './data',
    keepWorkspace: false,
    allowSkip: false,
    json: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--':
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      case '--config':
        args.configPath = requireValue(argv, ++i, '--config');
        break;
      case '--data':
        args.dataDir = requireValue(argv, ++i, '--data');
        break;
      case '--model':
        args.model = requireValue(argv, ++i, '--model');
        break;
      case '--auth-path':
        args.authPath = requireValue(argv, ++i, '--auth-path');
        break;
      case '--models-path':
        args.modelsPath = requireValue(argv, ++i, '--models-path');
        break;
      case '--timeout-ms':
        args.timeoutMs = parsePositiveInt(requireValue(argv, ++i, '--timeout-ms'), '--timeout-ms');
        break;
      case '--keep-workspace':
        args.keepWorkspace = true;
        break;
      case '--allow-skip':
        args.allowSkip = true;
        break;
      case '--json':
        args.json = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function loadConfiguredModel(
  args: PiWorkspaceSmokeArgs,
  loadConfig: typeof loadGlobalConfigWithOverlay = loadGlobalConfigWithOverlay,
): string | undefined {
  if (!args.configPath) return undefined;
  return loadConfig(
    resolve(args.configPath),
    getOverlayPath(resolve(args.dataDir)),
  ).defaults.model;
}

function writeResult(
  stream: Pick<NodeJS.WriteStream, 'write'>,
  json: boolean,
  result: SmokeResult,
): void {
  if (json) {
    stream.write(`${JSON.stringify(result)}\n`);
    return;
  }

  if (result.status === 'passed') {
    stream.write([
      'Pi workspace smoke passed.',
      `workspace: ${result.workspace}`,
      `sessionId: ${result.sessionId ?? '<none>'}`,
      `filesChanged: ${result.restore?.filesChanged?.join(', ') ?? '<none>'}`,
    ].join('\n'));
    stream.write('\n');
    return;
  }

  stream.write(`Pi workspace smoke ${result.status}: ${result.error ?? 'unknown error'}\n`);
}

function isRuntimeWithHandle(runtime: HeadlessRuntime): runtime is RuntimeWithHandle {
  return typeof (runtime as { runHandle?: unknown }).runHandle === 'function';
}

function assertFile(path: string, expected: string, message: string): void {
  if (!existsSync(path)) {
    throw new Error(`${message} File is missing: ${path}`);
  }
  const actual = readFileSync(path, 'utf8');
  if (normalizeSmokeFileText(actual) !== normalizeSmokeFileText(expected)) {
    throw new Error(`${message} Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}.`);
  }
}

function normalizeSmokeFileText(value: string): string {
  return value.endsWith('\n') ? value : `${value}\n`;
}

function isSkippableSmokeError(message: string): boolean {
  return /@earendil-works\/pi-coding-agent|optional package|api key|auth|oauth|credential|model registry/i
    .test(message);
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function parsePositiveInt(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer.`);
  }
  return parsed;
}

function usage(): string {
  return [
    'Usage: pnpm smoke:pi-workspace -- [--json] [--allow-skip]',
    '',
    'Options:',
    '  --config <path>       optional config.yml path used only for default model lookup',
    '  --data <dir>          data directory for runtime overlay when --config is used (default: ./data)',
    `  --model <model>       model override (default: ${DEFAULT_PI_MODEL_ID})`,
    '  --auth-path <path>    optional Pi auth.json path',
    '  --models-path <path>  optional Pi models.json path',
    '  --timeout-ms <ms>     positive integer timeout',
    '  --keep-workspace      keep the temporary smoke workspace for inspection',
    '  --allow-skip          exit 0 for missing optional Pi runtime/auth setup',
    '  --json                print structured smoke result',
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPiWorkspaceSmokeCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
