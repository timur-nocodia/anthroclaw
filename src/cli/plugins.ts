#!/usr/bin/env tsx

import { existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { discoverPluginCatalog } from '../plugins/discovery.js';
import { PluginInstallStore } from '../plugins/install-store.js';
import { installLocalPlugin } from '../plugins/installers/local.js';
import { installNpmPlugin } from '../plugins/installers/npm.js';
import { runPluginDoctor, type PluginDoctorResult } from '../plugins/doctor.js';

interface CliIO {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

interface ParsedArgs {
  command?: string;
  positional: string[];
  dataDir: string;
  pluginsDir: string;
}

export async function runPluginsCli(argv: string[], io: CliIO = defaultIO): Promise<number> {
  const args = parseArgs(argv);
  if (!args.command || args.command === 'help' || args.command === '--help') {
    io.stdout(helpText());
    return 0;
  }

  try {
    switch (args.command) {
      case 'list':
        return await commandList(args, io);
      case 'install':
        return await commandInstall(args, io);
      case 'update':
        return await commandUpdate(args, io);
      case 'remove':
        return commandRemove(args, io);
      case 'doctor':
        return await commandDoctor(args, io);
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

async function commandList(args: ParsedArgs, io: CliIO): Promise<number> {
  const catalog = await loadCatalog(args);
  if (catalog.entries.length === 0) {
    io.stdout('No plugins found.');
    return 0;
  }

  for (const entry of catalog.entries) {
    io.stdout([
      entry.name,
      entry.version ?? 'unknown',
      entry.sourceType,
      entry.status,
      entry.dependencyState ? `deps=${entry.dependencyState}` : undefined,
      entry.loaded ? 'loaded' : 'not-loaded',
    ].filter(Boolean).join('  '));
  }
  return catalog.duplicates.length > 0 ? 1 : 0;
}

async function commandInstall(args: ParsedArgs, io: CliIO): Promise<number> {
  const spec = args.positional[0];
  if (!spec) return usageError(io, 'install requires <spec>');
  const record = existsSync(resolve(spec))
    ? await installLocalPlugin({ sourcePath: spec, dataDir: args.dataDir })
    : await installNpmPlugin({ spec, dataDir: args.dataDir });
  io.stdout(`installed ${record.name}@${record.manifestVersion} from ${record.sourceType}`);
  return 0;
}

async function commandUpdate(args: ParsedArgs, io: CliIO): Promise<number> {
  const name = args.positional[0];
  if (!name) return usageError(io, 'update requires <name>');
  const store = new PluginInstallStore(join(resolve(args.dataDir), 'plugin-installs.json'));
  const record = store.get(name);
  if (!record || record.status !== 'installed') {
    io.stderr(`Managed plugin not found: ${name}`);
    return 1;
  }
  const updated = record.sourceType === 'local'
    ? await installLocalPlugin({ sourcePath: record.sourceSpec, dataDir: args.dataDir })
    : await installNpmPlugin({ spec: record.sourceSpec, dataDir: args.dataDir });
  io.stdout(`updated ${updated.name}@${updated.manifestVersion}`);
  return 0;
}

function commandRemove(args: ParsedArgs, io: CliIO): number {
  const name = args.positional[0];
  if (!name) return usageError(io, 'remove requires <name>');
  const store = new PluginInstallStore(join(resolve(args.dataDir), 'plugin-installs.json'));
  const record = store.get(name);
  if (!record) {
    io.stderr(`Managed plugin not found: ${name}`);
    return 1;
  }
  rmSync(record.installRoot, { recursive: true, force: true });
  store.remove(name);
  io.stdout(`removed ${name}`);
  return 0;
}

async function commandDoctor(args: ParsedArgs, io: CliIO): Promise<number> {
  const managedDir = join(resolve(args.dataDir), 'plugins-installed');
  const catalog = await loadCatalog(args);
  const results = await runPluginDoctor({ catalog, managedDir });
  for (const result of results) {
    io.stdout(formatDoctorResult(result));
  }
  return results.some((result) => result.status === 'error') ? 1 : 0;
}

async function loadCatalog(args: ParsedArgs) {
  const dataDir = resolve(args.dataDir);
  const store = new PluginInstallStore(join(dataDir, 'plugin-installs.json'));
  return discoverPluginCatalog({
    bundledDir: resolve(args.pluginsDir),
    managedDir: join(dataDir, 'plugins-installed'),
    installRecords: store.list(),
  });
}

function formatDoctorResult(result: PluginDoctorResult): string {
  return [
    `[${result.status}]`,
    result.name,
    '-',
    result.message,
    result.fix ? `fix=${JSON.stringify(result.fix)}` : undefined,
  ].filter(Boolean).join(' ');
}

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const out: ParsedArgs = {
    command: undefined,
    positional,
    dataDir: 'data',
    pluginsDir: 'plugins',
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--data-dir':
        out.dataDir = argv[++i] ?? out.dataDir;
        break;
      case '--plugins-dir':
        out.pluginsDir = argv[++i] ?? out.pluginsDir;
        break;
      default:
        if (!out.command) out.command = arg;
        else positional.push(arg);
    }
  }
  return out;
}

function usageError(io: CliIO, message: string): number {
  io.stderr(message);
  io.stderr(helpText());
  return 1;
}

function helpText(): string {
  return [
    'Usage: pnpm plugins <command> [options]',
    '',
    'Commands:',
    '  list',
    '  install <local-path|npm-spec>',
    '  update <name>',
    '  remove <name>',
    '  doctor',
    '',
    'Options:',
    '  --data-dir <dir>     AnthroClaw data directory (default: data)',
    '  --plugins-dir <dir>  Bundled plugins directory (default: plugins)',
  ].join('\n');
}

const defaultIO: CliIO = {
  stdout: (text) => console.log(text),
  stderr: (text) => console.error(text),
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const code = await runPluginsCli(process.argv.slice(2));
  process.exitCode = code;
}
