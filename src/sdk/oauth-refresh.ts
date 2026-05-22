import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

/**
 * Snapshot of the credentials.json file relevant to refresh logic.
 * We deliberately only extract the public-ish `expiresAt` epoch so we never
 * carry the access/refresh tokens through this code path — only the bare
 * `claude` binary needs them.
 */
export interface CredentialsSnapshot {
  expiresAt: number;
}

/**
 * Read `~/.claude/.credentials.json` (or wherever the SDK keeps it) and
 * return just the expiry epoch. Returns null when the file is missing,
 * unreadable, or doesn't carry an `expiresAt`. Callers should treat null
 * as "nothing to refresh from" — typically because the user hasn't run
 * `claude login` yet — and skip the refresh attempt.
 */
export function readCredentialsSnapshot(path: string): CredentialsSnapshot | null {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const oauth = (parsed as Record<string, unknown>).claudeAiOauth;
  if (!oauth || typeof oauth !== 'object') return null;
  const expiresAt = (oauth as Record<string, unknown>).expiresAt;
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) return null;
  return { expiresAt };
}

/**
 * Pure predicate: should we refresh given the current snapshot, clock, and
 * how much lead time we want before expiry?
 *
 * - null snapshot → false (nothing we can do)
 * - already expired → true
 * - within `leadMs` of expiry → true
 * - otherwise → false
 */
export function shouldRefresh(
  snapshot: CredentialsSnapshot | null,
  now: number,
  leadMs: number,
): boolean {
  if (!snapshot) return false;
  return snapshot.expiresAt - now <= leadMs;
}

export type RefreshOutcome = 'refreshed' | 'fresh' | 'no-credentials' | 'in-flight' | 'error';

export interface OAuthRefreshLogger {
  warn(payload: Record<string, unknown>, msg?: string): void;
  info(payload: Record<string, unknown>, msg?: string): void;
}

export interface OAuthRefreshDaemonOptions {
  credentialsPath: string;
  triggerRefresh: () => Promise<void>;
  refreshLeadMs?: number;
  tickIntervalMs?: number;
  now?: () => number;
  logger?: OAuthRefreshLogger;
  onError?: (err: Error) => void;
}

const DEFAULT_LEAD_MS = 5 * 60_000;
const DEFAULT_TICK_MS = 60_000;

/**
 * Polls the OAuth credentials file on a timer and proactively triggers a
 * refresh before access tokens expire, so the bare `claude` SDK binary
 * never has to handle 401s mid-stream. The actual refresh mechanism is
 * dependency-injected (`triggerRefresh`) — production wires it to a thin
 * `claude --print "."` spawn that causes the binary to refresh
 * credentials.json as a side effect of opening a new stream.
 *
 * Why poll instead of timeout-to-expiry: the binary may rotate the file
 * out from under us (its own lazy refresh) and we always want to base
 * decisions on the current on-disk state, not on a value we cached when
 * the daemon started.
 */
export class OAuthRefreshDaemon {
  private readonly opts: Required<Omit<OAuthRefreshDaemonOptions, 'logger' | 'onError'>> & {
    logger?: OAuthRefreshLogger;
    onError?: (err: Error) => void;
  };
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight = false;

  constructor(options: OAuthRefreshDaemonOptions) {
    this.opts = {
      credentialsPath: options.credentialsPath,
      triggerRefresh: options.triggerRefresh,
      refreshLeadMs: options.refreshLeadMs ?? DEFAULT_LEAD_MS,
      tickIntervalMs: options.tickIntervalMs ?? DEFAULT_TICK_MS,
      now: options.now ?? (() => Date.now()),
      logger: options.logger,
      onError: options.onError,
    };
  }

  start(): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, this.opts.tickIntervalMs);
    if (typeof (this.timer as { unref?: () => void }).unref === 'function') {
      (this.timer as { unref: () => void }).unref();
    }
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<RefreshOutcome> {
    if (this.inFlight) return 'in-flight';
    const snapshot = readCredentialsSnapshot(this.opts.credentialsPath);
    if (!snapshot) {
      this.opts.logger?.info(
        { credentialsPath: this.opts.credentialsPath },
        'OAuth refresh daemon: no credentials snapshot, skipping',
      );
      return 'no-credentials';
    }
    const now = this.opts.now();
    if (!shouldRefresh(snapshot, now, this.opts.refreshLeadMs)) {
      return 'fresh';
    }
    this.inFlight = true;
    try {
      const startedAt = now;
      this.opts.logger?.info(
        {
          expiresAtMs: snapshot.expiresAt,
          msUntilExpiry: snapshot.expiresAt - now,
          refreshLeadMs: this.opts.refreshLeadMs,
        },
        'OAuth refresh daemon: triggering proactive refresh',
      );
      await this.opts.triggerRefresh();
      const after = readCredentialsSnapshot(this.opts.credentialsPath);
      const newExpiry = after?.expiresAt ?? null;
      this.opts.logger?.info(
        {
          newExpiresAtMs: newExpiry,
          newMsUntilExpiry: newExpiry !== null ? newExpiry - this.opts.now() : null,
          durationMs: this.opts.now() - startedAt,
        },
        'OAuth refresh daemon: refresh attempt completed',
      );
      return 'refreshed';
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.opts.onError?.(error);
      this.opts.logger?.warn(
        { err: error.message },
        'OAuth refresh daemon: trigger threw',
      );
      return 'error';
    } finally {
      this.inFlight = false;
    }
  }
}

/**
 * Production-grade refresh trigger: invokes the bare `claude` CLI with a
 * one-token `--print` query. The CLI eagerly reads `.credentials.json`,
 * refreshes the access token if needed (it has the refresh-token flow
 * built in), and writes the rotated file back atomically. The query
 * itself we discard — we only want the refresh side effect.
 *
 * Times out so a hung CLI can't block the daemon forever. Resolves on
 * non-zero exit too — the caller cannot meaningfully recover, and the
 * next tick will re-check the file mtime to decide whether to retry.
 */
export function spawnClaudeWarmupRefresh(options: {
  runtimeHome: string;
  claudeBin: string;
  timeoutMs?: number;
}): () => Promise<void> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  return () =>
    new Promise<void>((resolve, reject) => {
      const child = spawn(options.claudeBin, ['--print', '.'], {
        cwd: options.runtimeHome,
        env: {
          ...process.env,
          HOME: options.runtimeHome,
          BROWSER: 'true',
          FORCE_COLOR: '0',
          NO_COLOR: '1',
        },
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let stderr = '';
      child.stderr?.on('data', (chunk) => {
        stderr += String(chunk);
      });
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`claude warmup timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0 || code === null) {
          resolve();
        } else {
          reject(new Error(`claude warmup exited ${code}${stderr ? `: ${stderr.slice(0, 200)}` : ''}`));
        }
      });
    });
}
