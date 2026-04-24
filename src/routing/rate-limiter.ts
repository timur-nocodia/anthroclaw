import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { logger } from '../logger.js';

export interface RateLimitConfig {
  /** Maximum messages allowed within the window. Default: 10 */
  maxAttempts: number;
  /** Sliding window duration in milliseconds. Default: 60 000 (1 min) */
  windowMs: number;
  /** Lockout duration after exceeding the limit, in milliseconds. Default: 300 000 (5 min) */
  lockoutMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs?: number;
}

const DEFAULT_CONFIG: RateLimitConfig = {
  maxAttempts: 10,
  windowMs: 60_000,
  lockoutMs: 300_000,
};

interface SenderRecord {
  timestamps: number[];
  lockedUntil?: number;
}

interface PersistedState {
  senders: Record<string, SenderRecord>;
  savedAt: number;
}

export class RateLimiter {
  private config: RateLimitConfig;
  private senders = new Map<string, SenderRecord>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private persistPath: string | null = null;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;

  constructor(config?: Partial<RateLimitConfig>, persistPath?: string) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.persistPath = persistPath ?? null;

    if (this.persistPath) {
      this.loadFromDisk();
    }

    // Periodic cleanup every 60 s to avoid unbounded memory growth
    this.cleanupTimer = setInterval(() => this.cleanup(), 60_000);
    // Unref so the timer doesn't keep the process alive
    if (this.cleanupTimer && typeof this.cleanupTimer === 'object' && 'unref' in this.cleanupTimer) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Check whether `senderId` is allowed to send right now.
   * Returns `{ allowed: true }` or `{ allowed: false, retryAfterMs }`.
   */
  check(senderId: string): RateLimitResult {
    const now = Date.now();
    let record = this.senders.get(senderId);

    if (!record) {
      record = { timestamps: [] };
      this.senders.set(senderId, record);
    }

    // If currently locked out, check whether lockout has expired
    if (record.lockedUntil !== undefined) {
      if (now < record.lockedUntil) {
        const retryAfterMs = record.lockedUntil - now;
        logger.debug({ senderId, retryAfterMs }, 'Rate limit: sender locked out');
        return { allowed: false, retryAfterMs };
      }
      // Lockout expired — reset
      record.lockedUntil = undefined;
      record.timestamps = [];
    }

    // Prune timestamps outside the current window
    const windowStart = now - this.config.windowMs;
    record.timestamps = record.timestamps.filter((ts) => ts > windowStart);

    // Check limit
    if (record.timestamps.length >= this.config.maxAttempts) {
      record.lockedUntil = now + this.config.lockoutMs;
      const retryAfterMs = this.config.lockoutMs;
      logger.info({ senderId, retryAfterMs, maxAttempts: this.config.maxAttempts }, 'Rate limit exceeded — sender locked out');
      this.schedulePersist();
      return { allowed: false, retryAfterMs };
    }

    // Record this attempt
    record.timestamps.push(now);
    this.schedulePersist();
    return { allowed: true };
  }

  /**
   * Remove stale entries whose window and lockout have both expired.
   */
  private cleanup(): void {
    const now = Date.now();
    const windowMs = this.config.windowMs;
    let removed = 0;

    for (const [senderId, record] of this.senders) {
      // If locked out and lockout hasn't expired, keep it
      if (record.lockedUntil !== undefined && now < record.lockedUntil) {
        continue;
      }

      // Remove timestamps outside window
      const windowStart = now - windowMs;
      record.timestamps = record.timestamps.filter((ts) => ts > windowStart);

      if (record.timestamps.length === 0 && (record.lockedUntil === undefined || now >= record.lockedUntil)) {
        this.senders.delete(senderId);
        removed++;
      }
    }

    if (removed > 0) {
      logger.debug({ removed }, 'Rate limiter cleanup');
    }
  }

  private schedulePersist(): void {
    if (!this.persistPath || this.persistTimer) return;
    this.dirty = true;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      if (this.dirty) this.saveToDisk();
    }, 5_000);
    if (typeof this.persistTimer === 'object' && 'unref' in this.persistTimer) {
      this.persistTimer.unref();
    }
  }

  private loadFromDisk(): void {
    if (!this.persistPath) return;
    try {
      const raw = readFileSync(this.persistPath, 'utf-8');
      const state: PersistedState = JSON.parse(raw);
      const now = Date.now();
      for (const [senderId, record] of Object.entries(state.senders)) {
        if (record.lockedUntil !== undefined && now >= record.lockedUntil) {
          continue;
        }
        const windowStart = now - this.config.windowMs;
        record.timestamps = record.timestamps.filter((ts) => ts > windowStart);
        if (record.timestamps.length > 0 || (record.lockedUntil !== undefined && now < record.lockedUntil)) {
          this.senders.set(senderId, record);
        }
      }
      logger.info({ path: this.persistPath, senders: this.senders.size }, 'Rate limit state loaded from disk');
    } catch {
      // File doesn't exist or is corrupt — start fresh
    }
  }

  private saveToDisk(): void {
    if (!this.persistPath) return;
    this.dirty = false;
    try {
      const obj: Record<string, SenderRecord> = {};
      for (const [k, v] of this.senders) {
        obj[k] = v;
      }
      const state: PersistedState = { senders: obj, savedAt: Date.now() };
      mkdirSync(dirname(this.persistPath), { recursive: true });
      writeFileSync(this.persistPath, JSON.stringify(state), 'utf-8');
    } catch (err) {
      logger.warn({ err, path: this.persistPath }, 'Failed to persist rate limit state');
    }
  }

  /**
   * Stop the periodic cleanup timer and flush pending persistence.
   */
  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    if (this.dirty) {
      this.saveToDisk();
    }
  }
}
