import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  OAuthRefreshDaemon,
  readCredentialsSnapshot,
  resolveClaudeBin,
  shouldRefresh,
} from '../oauth-refresh.js';

describe('resolveClaudeBin', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'resolve-claude-bin-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function makeBin(parent: string): string {
    const binDir = join(parent, 'node_modules', '.bin');
    mkdirSync(binDir, { recursive: true });
    const binPath = join(binDir, 'claude');
    writeFileSync(binPath, '#!/bin/sh\n');
    return binPath;
  }

  it('honors CLAUDE_BIN env when set to a non-empty string', () => {
    expect(resolveClaudeBin('/app', '/usr/local/bin/claude')).toBe('/usr/local/bin/claude');
    expect(resolveClaudeBin('/app', 'claude')).toBe('claude');
  });

  it('treats empty / whitespace env as unset', () => {
    const bin = makeBin(root);
    expect(resolveClaudeBin(root, '')).toBe(bin);
    expect(resolveClaudeBin(root, '   ')).toBe(bin);
    expect(resolveClaudeBin(root, undefined)).toBe(bin);
  });

  it('finds claude at <cwd>/node_modules/.bin/claude', () => {
    const bin = makeBin(root);
    expect(resolveClaudeBin(root, undefined)).toBe(bin);
  });

  it('walks up to parent directories until it finds node_modules/.bin/claude (workspace case)', () => {
    const bin = makeBin(root);
    const nested = join(root, 'ui');
    mkdirSync(nested, { recursive: true });
    // Nested dir has no node_modules of its own; should walk up to root.
    expect(resolveClaudeBin(nested, undefined)).toBe(bin);
  });

  it("falls back to bare 'claude' when nothing is found anywhere up the tree", () => {
    const deep = join(root, 'a', 'b', 'c');
    mkdirSync(deep, { recursive: true });
    expect(resolveClaudeBin(deep, undefined)).toBe('claude');
  });
});

describe('shouldRefresh', () => {
  it('returns false when expiresAt is comfortably in the future', () => {
    expect(shouldRefresh({ expiresAt: 1_000_000 + 60 * 60_000 }, 1_000_000, 300_000)).toBe(false);
  });

  it('returns true when expiresAt is within the lead window', () => {
    expect(shouldRefresh({ expiresAt: 1_000_000 + 2 * 60_000 }, 1_000_000, 300_000)).toBe(true);
  });

  it('returns true when expiresAt is already in the past', () => {
    expect(shouldRefresh({ expiresAt: 1_000_000 - 60_000 }, 1_000_000, 300_000)).toBe(true);
  });

  it('returns false when snapshot is null (nothing to refresh from)', () => {
    expect(shouldRefresh(null, 1_000_000, 300_000)).toBe(false);
  });
});

describe('readCredentialsSnapshot', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'oauth-refresh-test-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns null when file is missing', () => {
    expect(readCredentialsSnapshot(join(dir, 'missing.json'))).toBeNull();
  });

  it('parses claudeAiOauth.expiresAt from a real-shaped credentials file', () => {
    const path = join(dir, '.credentials.json');
    writeFileSync(
      path,
      JSON.stringify({
        claudeAiOauth: {
          accessToken: 'redacted',
          refreshToken: 'redacted',
          expiresAt: 1_779_393_748_963,
          scopes: ['user:inference'],
          subscriptionType: 'max',
        },
      }),
    );
    const snap = readCredentialsSnapshot(path);
    expect(snap?.expiresAt).toBe(1_779_393_748_963);
  });

  it('returns null when file is unreadable / not JSON', () => {
    const path = join(dir, 'bad.json');
    writeFileSync(path, 'not-json{{');
    expect(readCredentialsSnapshot(path)).toBeNull();
  });

  it('returns null when claudeAiOauth.expiresAt is absent', () => {
    const path = join(dir, 'minimal.json');
    writeFileSync(path, JSON.stringify({ claudeAiOauth: { accessToken: 'x' } }));
    expect(readCredentialsSnapshot(path)).toBeNull();
  });
});

describe('OAuthRefreshDaemon.tick', () => {
  let dir: string;
  let credPath: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'oauth-refresh-test-'));
    credPath = join(dir, '.credentials.json');
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeCreds(expiresAt: number): void {
    writeFileSync(credPath, JSON.stringify({ claudeAiOauth: { expiresAt } }));
  }

  it('reports "no-credentials" when the file is absent', async () => {
    const trigger = vi.fn();
    const daemon = new OAuthRefreshDaemon({
      credentialsPath: credPath,
      triggerRefresh: trigger,
      now: () => 1_000_000,
    });
    expect(await daemon.tick()).toBe('no-credentials');
    expect(trigger).not.toHaveBeenCalled();
  });

  it('reports "fresh" and does not trigger refresh when credentials are valid', async () => {
    writeCreds(1_000_000 + 60 * 60_000);
    const trigger = vi.fn();
    const daemon = new OAuthRefreshDaemon({
      credentialsPath: credPath,
      triggerRefresh: trigger,
      now: () => 1_000_000,
    });
    expect(await daemon.tick()).toBe('fresh');
    expect(trigger).not.toHaveBeenCalled();
  });

  it('triggers refresh when expiresAt is within the lead window', async () => {
    writeCreds(1_000_000 + 60_000);
    const trigger = vi.fn().mockResolvedValue(undefined);
    const daemon = new OAuthRefreshDaemon({
      credentialsPath: credPath,
      triggerRefresh: trigger,
      now: () => 1_000_000,
      refreshLeadMs: 300_000,
    });
    expect(await daemon.tick()).toBe('refreshed');
    expect(trigger).toHaveBeenCalledOnce();
  });

  it('does not trigger a second refresh while the first is in flight', async () => {
    writeCreds(1_000_000 + 60_000);
    let releaseTrigger: () => void = () => {};
    const trigger = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseTrigger = resolve;
        }),
    );
    const daemon = new OAuthRefreshDaemon({
      credentialsPath: credPath,
      triggerRefresh: trigger,
      now: () => 1_000_000,
    });
    const first = daemon.tick();
    expect(await daemon.tick()).toBe('in-flight');
    expect(trigger).toHaveBeenCalledOnce();
    releaseTrigger();
    expect(await first).toBe('refreshed');
  });

  it('reports "error" and does not throw when triggerRefresh rejects', async () => {
    writeCreds(1_000_000 + 60_000);
    const trigger = vi.fn().mockRejectedValue(new Error('claude not found'));
    const errors: unknown[] = [];
    const daemon = new OAuthRefreshDaemon({
      credentialsPath: credPath,
      triggerRefresh: trigger,
      now: () => 1_000_000,
      onError: (e) => errors.push(e),
    });
    expect(await daemon.tick()).toBe('error');
    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe('claude not found');
  });
});

describe('OAuthRefreshDaemon.start / stop', () => {
  it('schedules ticks at the configured interval and stop() clears them', async () => {
    vi.useFakeTimers();
    try {
      const trigger = vi.fn().mockResolvedValue(undefined);
      const daemon = new OAuthRefreshDaemon({
        credentialsPath: '/dev/null/missing.json',
        triggerRefresh: trigger,
        now: () => 1_000_000,
        tickIntervalMs: 5_000,
      });
      daemon.start();
      // After start(), an initial tick fires asynchronously + interval is armed.
      await vi.advanceTimersByTimeAsync(15_000);
      daemon.stop();
      const afterStop = trigger.mock.calls.length;
      await vi.advanceTimersByTimeAsync(60_000);
      expect(trigger.mock.calls.length).toBe(afterStop);
    } finally {
      vi.useRealTimers();
    }
  });
});
