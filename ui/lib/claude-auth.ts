import { randomUUID } from 'node:crypto';
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export interface ClaudeAuthProcess {
  stdout?: NodeJS.EventEmitter;
  stderr?: NodeJS.EventEmitter;
  stdin?: {
    write(chunk: string): boolean;
  };
  on(event: 'exit' | 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  kill(signal?: NodeJS.Signals): boolean;
}

export interface ClaudeRunOptions {
  timeoutMs: number;
  env: NodeJS.ProcessEnv;
  cwd: string;
}

export interface ClaudeRunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
}

export interface ClaudeAuthProcessAdapter {
  spawn(command: string, args: string[], options: ClaudeRunOptions): ClaudeAuthProcess;
  run(command: string, args: string[], options: ClaudeRunOptions): Promise<ClaudeRunResult>;
}

export interface ClaudeAuthCredentialFile {
  path: string;
  exists: boolean;
  updatedAt: string | null;
  ageMs: number | null;
}

export interface ClaudeAuthStatus {
  connected: boolean;
  loggedIn: boolean;
  authMethod: string;
  apiProvider: string | null;
  email: string | null;
  subscriptionType: string | null;
  runtimeHome: string;
  cliCommand: string;
  credentialFile: ClaudeAuthCredentialFile;
  checkedAt: string;
  error: string | null;
  pendingSession: ClaudeAuthSessionPublic | null;
}

export interface ClaudeAuthSessionPublic {
  sessionId: string;
  status: 'starting' | 'waiting_for_code' | 'completing' | 'failed';
  loginUrl: string | null;
  startedAt: string;
  expiresAt: string;
  safeOutput: string;
  error: string | null;
}

export interface ClaudeAuthStartResult extends ClaudeAuthSessionPublic {}

export interface ClaudeAuthCompleteResult {
  ok: boolean;
  sessionId: string;
  status: ClaudeAuthStatus;
  safeOutput: string;
  error: string | null;
}

export interface ClaudeAuthCancelResult {
  cancelled: boolean;
}

export interface ClaudeAuthVerifyResult {
  ok: boolean;
  checkedAt: string;
  message: string;
  stdoutPreview: string;
}

interface ActiveSession {
  id: string;
  proc: ClaudeAuthProcess;
  startedAtMs: number;
  expiresAtMs: number;
  status: ClaudeAuthSessionPublic['status'];
  output: string;
  loginUrl: string | null;
  error: string | null;
  closePromise: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

export interface ClaudeAuthManagerOptions {
  adapter?: ClaudeAuthProcessAdapter;
  runtimeHome?: string;
  cliCommand?: string;
  cwd?: string;
  now?: () => number;
  idGenerator?: () => string;
  sessionTimeoutMs?: number;
  startUrlTimeoutMs?: number;
  statusTimeoutMs?: number;
  verifyTimeoutMs?: number;
}

const DEFAULT_SESSION_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_START_URL_TIMEOUT_MS = 20_000;
const DEFAULT_STATUS_TIMEOUT_MS = 10_000;
const DEFAULT_VERIFY_TIMEOUT_MS = 45_000;
const MAX_OUTPUT_CHARS = 12_000;
const LOGIN_URL_RE = /https:\/\/claude\.com\/cai\/oauth\/authorize\?[^\s"'<>]+/;

export function getDefaultClaudeRuntimeHome(): string {
  return process.env.ANTHROCLAW_CLAUDE_HOME
    ?? process.env.CLAUDE_RUNTIME_HOME
    ?? process.env.HOME
    ?? homedir();
}

export function extractClaudeLoginUrl(output: string): string | null {
  return output.match(LOGIN_URL_RE)?.[0] ?? null;
}

export function redactClaudeAuthOutput(output: string): string {
  let redacted = output;
  redacted = redacted.replace(
    /https:\/\/claude\.com\/cai\/oauth\/authorize\?[^\s"'<>]+/g,
    (url) => {
      try {
        const parsed = new URL(url);
        const safe = new URL(`${parsed.origin}${parsed.pathname}`);
        for (const key of ['code', 'client_id', 'response_type', 'redirect_uri', 'scope', 'code_challenge_method']) {
          const value = parsed.searchParams.get(key);
          if (value) safe.searchParams.set(key, value);
        }
        if (parsed.searchParams.has('code_challenge')) safe.searchParams.set('code_challenge', '[redacted]');
        if (parsed.searchParams.has('state')) safe.searchParams.set('state', '[redacted]');
        return safe.toString();
      } catch {
        return 'https://claude.com/cai/oauth/authorize?[redacted]';
      }
    },
  );
  redacted = redacted.replace(/CLAUDE_CODE_OAUTH_TOKEN\s*=\s*['"]?[^'"\s]+/g, 'CLAUDE_CODE_OAUTH_TOKEN=[redacted]');
  redacted = redacted.replace(/\b(?:token|access_token|refresh_token)=([^&\s]+)/gi, (match) => {
    const [key] = match.split('=');
    return `${key}=[redacted]`;
  });
  redacted = redacted.replace(/\bsk-ant-[A-Za-z0-9._-]+/g, '[redacted-token]');
  return trimOutput(redacted);
}

export function buildClaudeCommandEnv(runtimeHome: string, cwd: string): NodeJS.ProcessEnv {
  const rootDir = resolve(cwd, '..');
  const existingPath = process.env.PATH ?? '';
  const pathEntries = [
    join(rootDir, 'node_modules', '.bin'),
    join(cwd, 'node_modules', '.bin'),
    existingPath,
  ].filter(Boolean);

  return {
    ...process.env,
    HOME: runtimeHome,
    BROWSER: process.env.BROWSER ?? 'true',
    FORCE_COLOR: '0',
    NO_COLOR: '1',
    PATH: pathEntries.join(':'),
  };
}

class NodeClaudeAuthProcessAdapter implements ClaudeAuthProcessAdapter {
  spawn(command: string, args: string[], options: ClaudeRunOptions): ClaudeAuthProcess {
    return nodeSpawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcess as ClaudeAuthProcess;
  }

  run(command: string, args: string[], options: ClaudeRunOptions): Promise<ClaudeRunResult> {
    return new Promise((resolveRun) => {
      const proc = nodeSpawn(command, args, {
        cwd: options.cwd,
        env: options.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        proc.kill('SIGTERM');
        resolveRun({ code: null, stdout, stderr, timedOut: true });
      }, options.timeoutMs);

      proc.stdout?.on('data', (chunk) => {
        stdout = trimOutput(stdout + String(chunk));
      });
      proc.stderr?.on('data', (chunk) => {
        stderr = trimOutput(stderr + String(chunk));
      });
      proc.on('error', (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolveRun({ code: 1, stdout, stderr: `${stderr}\n${error.message}`.trim() });
      });
      proc.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolveRun({ code, stdout, stderr });
      });
    });
  }
}

export class ClaudeAuthManager {
  private readonly adapter: ClaudeAuthProcessAdapter;
  private readonly runtimeHome: string;
  private readonly cliCommand: string;
  private readonly cwd: string;
  private readonly now: () => number;
  private readonly idGenerator: () => string;
  private readonly sessionTimeoutMs: number;
  private readonly startUrlTimeoutMs: number;
  private readonly statusTimeoutMs: number;
  private readonly verifyTimeoutMs: number;
  private active: ActiveSession | null = null;

  constructor(options: ClaudeAuthManagerOptions = {}) {
    this.adapter = options.adapter ?? new NodeClaudeAuthProcessAdapter();
    this.runtimeHome = options.runtimeHome ?? getDefaultClaudeRuntimeHome();
    this.cliCommand = options.cliCommand ?? process.env.CLAUDE_BIN ?? 'claude';
    this.cwd = options.cwd ?? process.cwd();
    this.now = options.now ?? (() => Date.now());
    this.idGenerator = options.idGenerator ?? (() => `claude_auth_${randomUUID()}`);
    this.sessionTimeoutMs = options.sessionTimeoutMs ?? DEFAULT_SESSION_TIMEOUT_MS;
    this.startUrlTimeoutMs = options.startUrlTimeoutMs ?? DEFAULT_START_URL_TIMEOUT_MS;
    this.statusTimeoutMs = options.statusTimeoutMs ?? DEFAULT_STATUS_TIMEOUT_MS;
    this.verifyTimeoutMs = options.verifyTimeoutMs ?? DEFAULT_VERIFY_TIMEOUT_MS;
  }

  getPendingSession(): ClaudeAuthSessionPublic | null {
    this.expireIfNeeded();
    return this.active ? this.publicSession(this.active) : null;
  }

  async getStatus(): Promise<ClaudeAuthStatus> {
    this.expireIfNeeded();
    const checkedAt = new Date(this.now()).toISOString();
    const env = buildClaudeCommandEnv(this.runtimeHome, this.cwd);
    const result = await this.adapter.run(
      this.cliCommand,
      ['auth', 'status', '--json'],
      { cwd: this.cwd, env, timeoutMs: this.statusTimeoutMs },
    );

    const credentialFile = this.getCredentialFile();
    const parsed = parseAuthStatusJson(result.stdout || result.stderr);
    const error = parsed.error
      ?? (result.timedOut ? 'claude auth status timed out' : null)
      ?? (result.code && result.code !== 0 ? safeError(result.stderr || result.stdout || `claude exited with ${result.code}`) : null);
    const loggedIn = Boolean(parsed.loggedIn);

    return {
      connected: loggedIn && !error,
      loggedIn,
      authMethod: parsed.authMethod ?? 'unknown',
      apiProvider: parsed.apiProvider ?? null,
      email: parsed.email ?? null,
      subscriptionType: parsed.subscriptionType ?? null,
      runtimeHome: this.runtimeHome,
      cliCommand: this.cliCommand,
      credentialFile,
      checkedAt,
      error,
      pendingSession: this.getPendingSession(),
    };
  }

  async startLogin(): Promise<ClaudeAuthStartResult> {
    this.expireIfNeeded();
    if (this.active && (this.active.status === 'starting' || this.active.status === 'waiting_for_code')) {
      return this.publicSession(this.active);
    }
    if (this.active) this.cancelLogin(this.active.id);

    const now = this.now();
    const proc = this.adapter.spawn(
      this.cliCommand,
      ['auth', 'login', '--claudeai'],
      {
        cwd: this.cwd,
        env: buildClaudeCommandEnv(this.runtimeHome, this.cwd),
        timeoutMs: this.sessionTimeoutMs,
      },
    );
    const session: ActiveSession = {
      id: this.idGenerator(),
      proc,
      startedAtMs: now,
      expiresAtMs: now + this.sessionTimeoutMs,
      status: 'starting',
      output: '',
      loginUrl: null,
      error: null,
      closePromise: waitForClose(proc),
    };
    this.active = session;

    const onOutput = (chunk: unknown) => {
      session.output = trimOutput(session.output + String(chunk));
      session.loginUrl = session.loginUrl ?? extractClaudeLoginUrl(session.output);
      if (session.loginUrl && session.status === 'starting') {
        session.status = 'waiting_for_code';
      }
    };
    session.proc.stdout?.on('data', onOutput);
    session.proc.stderr?.on('data', onOutput);
    session.proc.on('error', (error) => {
      session.status = 'failed';
      session.error = safeError(error.message);
    });

    await this.waitForLoginUrl(session);
    return this.publicSession(session);
  }

  async completeLogin(sessionId: string, code: string): Promise<ClaudeAuthCompleteResult> {
    this.expireIfNeeded();
    const session = this.active;
    if (!session || session.id !== sessionId) {
      throw new Error('auth_session_not_found');
    }
    const trimmedCode = code.trim();
    if (!trimmedCode || /[\r\n]/.test(trimmedCode)) {
      throw new Error('invalid_auth_code');
    }
    if (session.status !== 'waiting_for_code') {
      throw new Error('auth_session_not_ready');
    }
    if (!session.proc.stdin) {
      throw new Error('auth_session_stdin_unavailable');
    }

    session.status = 'completing';
    session.proc.stdin.write(`${trimmedCode}\n`);
    const close = await session.closePromise;
    if (close.code !== 0) {
      session.status = 'failed';
      session.error = safeError(session.output || `claude exited with ${close.code ?? close.signal ?? 'unknown'}`);
    }

    const status = await this.getStatus();
    const ok = status.connected;
    if (ok || session.status === 'failed') {
      this.active = null;
    }

    return {
      ok,
      sessionId,
      status,
      safeOutput: redactClaudeAuthOutput(session.output),
      error: ok ? null : session.error ?? status.error ?? 'Claude authentication did not complete.',
    };
  }

  cancelLogin(sessionId?: string): ClaudeAuthCancelResult {
    const session = this.active;
    if (!session) return { cancelled: false };
    if (sessionId && session.id !== sessionId) return { cancelled: false };
    session.proc.kill('SIGTERM');
    this.active = null;
    return { cancelled: true };
  }

  async verifyQuery(): Promise<ClaudeAuthVerifyResult> {
    const checkedAt = new Date(this.now()).toISOString();
    const result = await this.adapter.run(
      this.cliCommand,
      ['--print', 'Reply with OK only.'],
      {
        cwd: this.cwd,
        env: buildClaudeCommandEnv(this.runtimeHome, this.cwd),
        timeoutMs: this.verifyTimeoutMs,
      },
    );
    const output = redactClaudeAuthOutput(`${result.stdout}\n${result.stderr}`.trim());
    const ok = result.code === 0 && /\bOK\b/i.test(result.stdout);
    return {
      ok,
      checkedAt,
      message: ok
        ? 'Claude runtime accepted a real query.'
        : result.timedOut
          ? 'Claude verification timed out.'
          : safeError(output || `Claude verification exited with ${result.code ?? 'unknown'}.`),
      stdoutPreview: trimOutput(output).slice(0, 600),
    };
  }

  private async waitForLoginUrl(session: ActiveSession): Promise<void> {
    const started = this.now();
    while (this.active === session && !session.loginUrl && session.status !== 'failed') {
      const elapsed = this.now() - started;
      if (elapsed >= this.startUrlTimeoutMs) {
        session.status = 'failed';
        session.error = 'Claude did not produce an authorization URL in time.';
        session.proc.kill('SIGTERM');
        break;
      }
      const closed = await Promise.race([
        session.closePromise.then(() => true),
        sleep(50).then(() => false),
      ]);
      if (closed && !session.loginUrl) {
        session.status = 'failed';
        session.error = safeError(session.output || 'Claude auth exited before producing an authorization URL.');
        break;
      }
    }
  }

  private expireIfNeeded(): void {
    if (!this.active) return;
    if (this.now() <= this.active.expiresAtMs) return;
    this.active.proc.kill('SIGTERM');
    this.active = null;
  }

  private publicSession(session: ActiveSession): ClaudeAuthSessionPublic {
    return {
      sessionId: session.id,
      status: session.status,
      loginUrl: session.loginUrl,
      startedAt: new Date(session.startedAtMs).toISOString(),
      expiresAt: new Date(session.expiresAtMs).toISOString(),
      safeOutput: redactClaudeAuthOutput(session.output),
      error: session.error,
    };
  }

  private getCredentialFile(): ClaudeAuthCredentialFile {
    const path = join(this.runtimeHome, '.claude', '.credentials.json');
    if (!existsSync(path)) {
      return { path, exists: false, updatedAt: null, ageMs: null };
    }
    const stat = statSync(path);
    return {
      path,
      exists: true,
      updatedAt: stat.mtime.toISOString(),
      ageMs: Math.max(0, this.now() - stat.mtimeMs),
    };
  }
}

function parseAuthStatusJson(output: string): {
  loggedIn?: boolean;
  authMethod?: string;
  apiProvider?: string;
  email?: string;
  subscriptionType?: string;
  error?: string;
} {
  try {
    const parsed = JSON.parse(output) as Record<string, unknown>;
    return {
      loggedIn: parsed.loggedIn === true,
      authMethod: typeof parsed.authMethod === 'string' ? parsed.authMethod : undefined,
      apiProvider: typeof parsed.apiProvider === 'string' ? parsed.apiProvider : undefined,
      email: typeof parsed.email === 'string' ? parsed.email : undefined,
      subscriptionType: typeof parsed.subscriptionType === 'string' ? parsed.subscriptionType : undefined,
    };
  } catch {
    return { error: safeError(output || 'Claude auth status returned invalid JSON.') };
  }
}

function waitForClose(proc: ClaudeAuthProcess): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolveClose) => {
    let settled = false;
    const done = (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      resolveClose({ code, signal });
    };
    proc.on('close', done);
    proc.on('exit', done);
    proc.on('error', () => done(1, null));
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function trimOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_CHARS) return output;
  return output.slice(output.length - MAX_OUTPUT_CHARS);
}

function safeError(message: string): string {
  return redactClaudeAuthOutput(message).slice(0, 1_000);
}
