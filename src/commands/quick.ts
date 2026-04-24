import { execSync } from 'node:child_process';

export interface QuickCommand {
  command: string;
  timeout: number; // seconds, default 30
}

export interface QuickCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

const MAX_BUFFER = 1024 * 1024; // 1 MB

/**
 * Execute a quick command via child_process.execSync.
 * Never throws — all errors captured in result.
 */
export function executeQuickCommand(cmd: QuickCommand): QuickCommandResult {
  try {
    const stdout = execSync(cmd.command, {
      timeout: (cmd.timeout || 30) * 1000,
      encoding: 'utf8',
      shell: '/bin/sh',
      maxBuffer: MAX_BUFFER,
    });
    return { stdout, stderr: '', exitCode: 0, timedOut: false };
  } catch (err: unknown) {
    const e = err as {
      stdout?: string;
      stderr?: string;
      status?: number | null;
      killed?: boolean;
      signal?: string | null;
    };
    const timedOut = e.killed === true || e.signal === 'SIGTERM';
    return {
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
      exitCode: e.status ?? 1,
      timedOut,
    };
  }
}

/**
 * Check if message starts with "/" and matches a quick command key.
 * Returns null if no match.
 */
export function matchQuickCommand(
  message: string,
  commands: Record<string, QuickCommand>,
): { name: string; command: QuickCommand } | null {
  if (!message.startsWith('/')) return null;
  const name = message.slice(1).split(/\s/)[0];
  const command = commands[name];
  if (!command) return null;
  return { name, command };
}
