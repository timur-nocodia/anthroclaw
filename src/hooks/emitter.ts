import { exec } from 'node:child_process';
import { logger } from '../logger.js';

// ─── Types ────────────────────────────────────────────────────────

export type HookEvent =
  | 'on_message_received'
  | 'on_before_query'
  | 'on_after_query'
  | 'on_session_reset'
  | 'on_cron_fire'
  | 'on_memory_write'
  | 'on_tool_use'
  | 'on_tool_result'
  | 'on_tool_error'
  | 'on_permission_request'
  | 'on_sdk_notification'
  | 'on_subagent_start'
  | 'on_subagent_stop';

export interface HookConfig {
  event: HookEvent;
  action: 'webhook' | 'script';
  url?: string;
  command?: string;
  timeout_ms: number;
}

export type HookListener = (payload: Record<string, unknown>) => void | Promise<void>;

// ─── HookEmitter ──────────────────────────────────────────────────

export class HookEmitter {
  private hooks: HookConfig[];
  private listeners = new Map<HookEvent, Set<HookListener>>();

  constructor(hooks: HookConfig[]) {
    this.hooks = hooks;
  }

  subscribe(event: HookEvent, listener: HookListener): () => void {
    const listeners = this.listeners.get(event) ?? new Set<HookListener>();
    listeners.add(listener);
    this.listeners.set(event, listeners);

    return () => {
      const current = this.listeners.get(event);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) {
        this.listeners.delete(event);
      }
    };
  }

  /**
   * Emit a hook event with a payload.
   * Fires all matching hooks concurrently (fire-and-forget semantics).
   * Never throws — all errors are logged and swallowed.
   */
  async emit(event: HookEvent, payload: Record<string, unknown>): Promise<void> {
    const matching = this.hooks.filter((h) => h.event === event);
    const listeners = [...(this.listeners.get(event) ?? [])];
    if (matching.length === 0 && listeners.length === 0) return;

    const results = [
      ...matching.map((hook) => this.executeHook(hook, payload)),
      ...listeners.map((listener) => this.executeListener(event, listener, payload)),
    ];
    await Promise.allSettled(results);
  }

  private async executeHook(hook: HookConfig, payload: Record<string, unknown>): Promise<void> {
    try {
      if (hook.action === 'webhook') {
        await this.fireWebhook(hook, payload);
      } else if (hook.action === 'script') {
        await this.fireScript(hook, payload);
      }
    } catch (err) {
      logger.error(
        { err, event: hook.event, action: hook.action },
        'Hook execution failed',
      );
    }
  }

  private async executeListener(
    event: HookEvent,
    listener: HookListener,
    payload: Record<string, unknown>,
  ): Promise<void> {
    try {
      await listener(payload);
    } catch (err) {
      logger.error({ err, event }, 'Hook listener failed');
    }
  }

  private async fireWebhook(hook: HookConfig, payload: Record<string, unknown>): Promise<void> {
    if (!hook.url) return;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), hook.timeout_ms);

    try {
      const resp = await fetch(hook.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!resp.ok) {
        logger.warn(
          { event: hook.event, url: hook.url, status: resp.status },
          'Webhook returned non-OK status',
        );
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        logger.warn(
          { event: hook.event, url: hook.url, timeout_ms: hook.timeout_ms },
          'Webhook timed out',
        );
      } else {
        throw err;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  private async fireScript(hook: HookConfig, payload: Record<string, unknown>): Promise<void> {
    if (!hook.command) return;

    // Pass payload fields as environment variables prefixed with HOOK_
    const env: Record<string, string> = { ...process.env } as Record<string, string>;
    for (const [key, value] of Object.entries(payload)) {
      env[`HOOK_${key.toUpperCase()}`] = String(value ?? '');
    }

    return new Promise<void>((resolve) => {
      const child = exec(hook.command!, { env: env as NodeJS.ProcessEnv, timeout: hook.timeout_ms }, (err: Error | null) => {
        if (err) {
          logger.warn(
            { event: hook.event, command: hook.command, err: err.message },
            'Script hook failed',
          );
        }
        resolve();
      });

      // Swallow stdio errors
      child.stdout?.on('error', () => {});
      child.stderr?.on('error', () => {});
    });
  }
}
