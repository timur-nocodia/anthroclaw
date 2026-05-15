import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getOverlayPath, loadGlobalConfigWithOverlay } from '../config/overlay.js';
import type { HeadlessRuntimeProvider } from '../config/schema.js';
import { runHeadlessReview } from '../sdk/headless-review.js';
import {
  headlessRuntimeOptionsFromConfig,
} from '../sdk/headless-runtime-config.js';

interface HeadlessRuntimeCliArgs {
  configPath: string;
  dataDir: string;
  prompt?: string;
  promptFile?: string;
  runtime?: HeadlessRuntimeProvider;
  model?: string;
  cwd?: string;
  timeoutMs?: number;
  help: boolean;
}

interface HeadlessRuntimeCliDeps {
  review?: typeof runHeadlessReview;
  loadConfig?: typeof loadGlobalConfigWithOverlay;
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
  stderr?: Pick<NodeJS.WriteStream, 'write'>;
}

export async function runHeadlessRuntimeCli(
  argv: string[],
  deps: HeadlessRuntimeCliDeps = {},
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const review = deps.review ?? runHeadlessReview;
  const loadConfig = deps.loadConfig ?? loadGlobalConfigWithOverlay;

  let args: HeadlessRuntimeCliArgs;
  try {
    args = parseHeadlessRuntimeCliArgs(argv);
  } catch (err) {
    stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    stderr.write(`${usage()}\n`);
    return 2;
  }

  if (args.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  try {
    const prompt = readPrompt(args);
    const config = loadConfig(
      resolve(args.configPath),
      getOverlayPath(resolve(args.dataDir)),
    );
    const runtimeFromConfig = headlessRuntimeOptionsFromConfig(config);
    const runtimeFromFlag = args.runtime
      ? { runtime: args.runtime }
      : {};

    const result = await review({
      prompt,
      model: args.model ?? config.defaults.model,
      cwd: args.cwd ? resolve(args.cwd) : process.cwd(),
      timeoutMs: args.timeoutMs,
      purpose: 'headless runtime smoke',
      toolDenyMessage: 'Tools disabled for headless runtime smoke.',
      ...runtimeFromConfig,
      ...runtimeFromFlag,
    });

    stdout.write(`${result}\n`);
    return 0;
  } catch (err) {
    stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}

export function parseHeadlessRuntimeCliArgs(argv: string[]): HeadlessRuntimeCliArgs {
  const args: HeadlessRuntimeCliArgs = {
    configPath: './config.yml',
    dataDir: './data',
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
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
      case '--prompt':
        args.prompt = requireValue(argv, ++i, '--prompt');
        break;
      case '--prompt-file':
        args.promptFile = requireValue(argv, ++i, '--prompt-file');
        break;
      case '--runtime':
        args.runtime = parseRuntimeProvider(requireValue(argv, ++i, '--runtime'));
        break;
      case '--model':
        args.model = requireValue(argv, ++i, '--model');
        break;
      case '--cwd':
        args.cwd = requireValue(argv, ++i, '--cwd');
        break;
      case '--timeout-ms':
        args.timeoutMs = parsePositiveInt(requireValue(argv, ++i, '--timeout-ms'), '--timeout-ms');
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.help && Boolean(args.prompt) === Boolean(args.promptFile)) {
    throw new Error('Provide exactly one of --prompt or --prompt-file.');
  }

  return args;
}

function readPrompt(args: HeadlessRuntimeCliArgs): string {
  if (args.promptFile) {
    return readFileSync(resolve(args.promptFile), 'utf-8');
  }
  if (args.prompt) return args.prompt;
  throw new Error('Provide exactly one of --prompt or --prompt-file.');
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function parseRuntimeProvider(value: string): HeadlessRuntimeProvider {
  if (value === 'claude-agent-sdk' || value === 'pi') return value;
  throw new Error(`Unknown headless runtime provider: ${value}`);
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
    'Usage: pnpm headless:runtime -- --prompt "..." [--runtime claude-agent-sdk|pi]',
    '',
    'Options:',
    '  --config <path>       config.yml path (default: ./config.yml)',
    '  --data <dir>          data directory for runtime overlay (default: ./data)',
    '  --prompt <text>       prompt text',
    '  --prompt-file <path>  read prompt from file',
    '  --runtime <provider>  override config runtime.headless.provider',
    '  --model <model>       model override',
    '  --cwd <dir>           working directory for the headless run',
    '  --timeout-ms <ms>     positive integer timeout',
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runHeadlessRuntimeCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
