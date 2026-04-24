import { describe, it, expect, vi, afterEach } from 'vitest';
import { existsSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RateLimiter } from '../../src/routing/rate-limiter.js';

describe('RateLimiter', () => {
  let limiter: RateLimiter;
  let tmpDir: string | null = null;

  afterEach(() => {
    limiter?.stop();
    if (tmpDir) {
      try { rmSync(tmpDir, { recursive: true }); } catch {}
      tmpDir = null;
    }
  });

  function makeTmpPath(): string {
    tmpDir = join(tmpdir(), `rl-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    return join(tmpDir, 'rate-limits.json');
  }

  it('allows messages under the limit', () => {
    limiter = new RateLimiter({ maxAttempts: 3, windowMs: 60_000, lockoutMs: 300_000 });

    expect(limiter.check('user1')).toEqual({ allowed: true });
    expect(limiter.check('user1')).toEqual({ allowed: true });
    expect(limiter.check('user1')).toEqual({ allowed: true });
  });

  it('blocks after maxAttempts exceeded', () => {
    limiter = new RateLimiter({ maxAttempts: 2, windowMs: 60_000, lockoutMs: 10_000 });

    expect(limiter.check('user1').allowed).toBe(true);
    expect(limiter.check('user1').allowed).toBe(true);

    const result = limiter.check('user1');
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeDefined();
    expect(result.retryAfterMs!).toBeGreaterThan(0);
    expect(result.retryAfterMs!).toBeLessThanOrEqual(10_000);
  });

  it('tracks senders independently', () => {
    limiter = new RateLimiter({ maxAttempts: 1, windowMs: 60_000, lockoutMs: 10_000 });

    expect(limiter.check('user-a').allowed).toBe(true);
    expect(limiter.check('user-b').allowed).toBe(true);

    // user-a is now locked out
    expect(limiter.check('user-a').allowed).toBe(false);
    // user-b is also locked out
    expect(limiter.check('user-b').allowed).toBe(false);
  });

  it('resets after lockout expires', () => {
    vi.useFakeTimers();
    try {
      limiter = new RateLimiter({ maxAttempts: 1, windowMs: 60_000, lockoutMs: 5_000 });

      expect(limiter.check('user1').allowed).toBe(true);
      expect(limiter.check('user1').allowed).toBe(false);

      // Advance past the lockout
      vi.advanceTimersByTime(5_001);

      expect(limiter.check('user1').allowed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('sliding window expires old timestamps', () => {
    vi.useFakeTimers();
    try {
      limiter = new RateLimiter({ maxAttempts: 2, windowMs: 10_000, lockoutMs: 5_000 });

      // Send 2 messages (at limit)
      expect(limiter.check('user1').allowed).toBe(true);
      expect(limiter.check('user1').allowed).toBe(true);

      // Advance past the window so old timestamps expire
      vi.advanceTimersByTime(11_000);

      // Should be allowed again (timestamps pruned)
      expect(limiter.check('user1').allowed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns decreasing retryAfterMs during lockout', () => {
    vi.useFakeTimers();
    try {
      limiter = new RateLimiter({ maxAttempts: 1, windowMs: 60_000, lockoutMs: 10_000 });

      limiter.check('user1'); // allowed
      const first = limiter.check('user1'); // locked
      expect(first.allowed).toBe(false);
      const firstRetry = first.retryAfterMs!;

      vi.advanceTimersByTime(3_000);

      const second = limiter.check('user1');
      expect(second.allowed).toBe(false);
      expect(second.retryAfterMs!).toBeLessThan(firstRetry);
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses default config values', () => {
    limiter = new RateLimiter();

    // Should allow up to 10 messages (default maxAttempts)
    for (let i = 0; i < 10; i++) {
      expect(limiter.check('user1').allowed).toBe(true);
    }
    // 11th should be blocked
    expect(limiter.check('user1').allowed).toBe(false);
  });

  it('stop() is safe to call multiple times', () => {
    limiter = new RateLimiter();
    limiter.stop();
    limiter.stop(); // should not throw
  });

  // ─── Persistence tests ──────────────────────────────────────────

  it('persists state to disk on stop()', () => {
    const path = makeTmpPath();
    limiter = new RateLimiter({ maxAttempts: 5, windowMs: 60_000, lockoutMs: 10_000 }, path);

    limiter.check('user1');
    limiter.check('user1');
    limiter.stop();

    expect(existsSync(path)).toBe(true);
    const data = JSON.parse(readFileSync(path, 'utf-8'));
    expect(data.senders.user1).toBeDefined();
    expect(data.senders.user1.timestamps).toHaveLength(2);
    expect(data.savedAt).toBeGreaterThan(0);
  });

  it('loads state from disk on startup', () => {
    const path = makeTmpPath();

    // First limiter: accumulate state
    limiter = new RateLimiter({ maxAttempts: 3, windowMs: 60_000, lockoutMs: 10_000 }, path);
    limiter.check('user1');
    limiter.check('user1');
    limiter.stop();

    // Second limiter: should pick up persisted state
    const limiter2 = new RateLimiter({ maxAttempts: 3, windowMs: 60_000, lockoutMs: 10_000 }, path);
    // 3rd check should hit the limit
    const result = limiter2.check('user1');
    expect(result.allowed).toBe(true); // 3rd attempt is the limit

    const blocked = limiter2.check('user1');
    expect(blocked.allowed).toBe(false);
    limiter2.stop();
  });

  it('discards expired lockouts when loading from disk', () => {
    const path = makeTmpPath();

    // Manually write a state file with an expired lockout
    const now = Date.now();
    const state = {
      senders: {
        expired_user: { timestamps: [now - 120_000], lockedUntil: now - 1000 },
        active_user: { timestamps: [now - 5_000], lockedUntil: now + 60_000 },
      },
      savedAt: now - 2000,
    };
    mkdirSync(tmpDir!, { recursive: true });
    require('fs').writeFileSync(path, JSON.stringify(state));

    limiter = new RateLimiter({ maxAttempts: 5, windowMs: 60_000, lockoutMs: 10_000 }, path);

    // expired_user should be allowed (lockout expired)
    expect(limiter.check('expired_user').allowed).toBe(true);
    // active_user should still be locked
    expect(limiter.check('active_user').allowed).toBe(false);
  });

  it('works normally without persistPath', () => {
    limiter = new RateLimiter({ maxAttempts: 2, windowMs: 60_000, lockoutMs: 10_000 });

    expect(limiter.check('user1').allowed).toBe(true);
    expect(limiter.check('user1').allowed).toBe(true);
    expect(limiter.check('user1').allowed).toBe(false);
    limiter.stop(); // should not throw
  });
});
