import { execFile } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { extname, isAbsolute, relative, resolve } from 'node:path';

const DEFAULT_SCRIPT_TIMEOUT_MS = 30_000;
const MAX_SCRIPT_OUTPUT_BYTES = 262_144;

export interface HeartbeatScriptResult {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal?: string | null;
  timedOut: boolean;
  wakeAgent?: boolean;
  error?: string;
}

export async function runHeartbeatTaskScript(params: {
  workspacePath: string;
  script: string;
  timeoutMs?: number;
}): Promise<HeartbeatScriptResult> {
  const command = params.script.trim();
  try {
    const parts = splitCommandLine(command);
    if (parts.length === 0) {
      return scriptError(command, 'script command is empty');
    }

    const scriptPath = parts[0];
    if (!scriptPath || isAbsolute(scriptPath)) {
      return scriptError(command, 'script path must be relative to the agent workspace');
    }

    const workspaceReal = realpathSync(params.workspacePath);
    const resolved = resolve(params.workspacePath, scriptPath);
    if (!existsSync(resolved)) {
      return scriptError(command, `script not found: ${scriptPath}`);
    }
    const scriptReal = realpathSync(resolved);
    if (!isInside(workspaceReal, scriptReal)) {
      return scriptError(command, 'script path escapes the agent workspace');
    }

    const ext = extname(scriptReal).toLowerCase();
    const executable = ['.js', '.mjs', '.cjs'].includes(ext) ? process.execPath : scriptReal;
    const args = ['.js', '.mjs', '.cjs'].includes(ext)
      ? [scriptReal, ...parts.slice(1)]
      : parts.slice(1);

    const result = await execFileResult(executable, args, params.workspacePath, params.timeoutMs ?? DEFAULT_SCRIPT_TIMEOUT_MS);
    const gate = parseWakeGate(result.stdout);
    return {
      command,
      ...result,
      stdout: gate.stdout,
      ...(gate.wakeAgent !== undefined ? { wakeAgent: gate.wakeAgent } : {}),
    };
  } catch (err) {
    return scriptError(command, err instanceof Error ? err.message : String(err));
  }
}

function execFileResult(
  file: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<Omit<HeartbeatScriptResult, 'command' | 'wakeAgent'>> {
  return new Promise((resolvePromise) => {
    execFile(
      file,
      args,
      {
        cwd,
        timeout: timeoutMs,
        maxBuffer: MAX_SCRIPT_OUTPUT_BYTES,
        encoding: 'utf8',
      },
      (error, stdout, stderr) => {
        const err = error as (NodeJS.ErrnoException & { code?: number | string; signal?: string; killed?: boolean }) | null;
        const timedOut = err?.killed === true && err.signal === 'SIGTERM';
        resolvePromise({
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? ''),
          exitCode: typeof err?.code === 'number' ? err.code : err ? 1 : 0,
          signal: err?.signal ?? null,
          timedOut,
          ...(err ? { error: timedOut ? `script timed out after ${timeoutMs}ms` : err.message } : {}),
        });
      },
    );
  });
}

function splitCommandLine(command: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < command.length; i += 1) {
    const char = command[i];
    if (!char) continue;
    if (char === '\n' || char === '\r') {
      throw new Error('script command must be a single line');
    }
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        parts.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }

  if (quote) {
    throw new Error('script command has an unterminated quote');
  }
  if (current) parts.push(current);
  return parts;
}

function parseWakeGate(stdout: string): { stdout: string; wakeAgent?: boolean } {
  const lines = stdout.split(/\r?\n/);
  let lastNonEmpty = -1;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i]?.trim()) {
      lastNonEmpty = i;
      break;
    }
  }
  if (lastNonEmpty < 0) return { stdout };

  try {
    const parsed = JSON.parse(lines[lastNonEmpty]!.trim()) as { wakeAgent?: unknown };
    if (typeof parsed.wakeAgent === 'boolean') {
      const withoutGate = [...lines];
      withoutGate.splice(lastNonEmpty, 1);
      return { stdout: withoutGate.join('\n').trimEnd(), wakeAgent: parsed.wakeAgent };
    }
  } catch {
    // Not a wake gate line; keep stdout verbatim.
  }
  return { stdout };
}

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function scriptError(command: string, error: string): HeartbeatScriptResult {
  return {
    command,
    stdout: '',
    stderr: '',
    exitCode: 1,
    timedOut: false,
    error,
  };
}
