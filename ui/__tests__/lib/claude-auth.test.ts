import { EventEmitter } from 'node:events';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  ClaudeAuthManager,
  extractClaudeLoginUrl,
  redactClaudeAuthOutput,
  type ClaudeAuthProcess,
  type ClaudeAuthProcessAdapter,
} from '@/lib/claude-auth';

class FakeProcess extends EventEmitter implements ClaudeAuthProcess {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin = {
    writes: [] as string[],
    write: (chunk: string) => {
      this.stdin.writes.push(chunk);
      return true;
    },
  };
  killed = false;

  kill(): boolean {
    this.killed = true;
    this.emit('exit', null, 'SIGTERM');
    this.emit('close', null, 'SIGTERM');
    return true;
  }

  writeStdout(chunk: string): void {
    this.stdout.emit('data', Buffer.from(chunk));
  }

  writeStderr(chunk: string): void {
    this.stderr.emit('data', Buffer.from(chunk));
  }

  close(code = 0): void {
    this.emit('exit', code, null);
    this.emit('close', code, null);
  }
}

function adapterFor(processes: FakeProcess[], run = vi.fn()): ClaudeAuthProcessAdapter {
  return {
    spawn: vi.fn(() => {
      const proc = processes.shift();
      if (!proc) throw new Error('no fake process available');
      return proc;
    }),
    run,
  };
}

describe('Claude auth output helpers', () => {
  it('extracts the Claude subscription OAuth URL from CLI output', () => {
    const output = [
      'Opening browser to sign in...',
      "If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true&client_id=abc&state=st_123",
      'Paste code here if prompted > ',
    ].join('\n');

    expect(extractClaudeLoginUrl(output)).toBe(
      'https://claude.com/cai/oauth/authorize?code=true&client_id=abc&state=st_123',
    );
  });

  it('redacts OAuth query material and subscription tokens from operator output', () => {
    const raw = 'visit https://claude.com/cai/oauth/authorize?code=true&code_challenge=secret&state=abc token=fake-oauth-token CLAUDE_CODE_OAUTH_TOKEN=fake-oauth-token';

    const redacted = redactClaudeAuthOutput(raw);

    expect(redacted).toContain('https://claude.com/cai/oauth/authorize');
    expect(redacted).not.toContain('secret');
    expect(redacted).not.toContain('abc');
    expect(redacted).toContain('CLAUDE_CODE_OAUTH_TOKEN=[redacted]');
  });
});

describe('ClaudeAuthManager', () => {
  it('returns sanitized status from claude auth status and credential file metadata', async () => {
    const home = mkdtempSync(join(tmpdir(), 'claude-auth-status-'));
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(join(home, '.claude', '.credentials.json'), '{"token":"do-not-return"}');
    const run = vi.fn(async () => ({
      code: 0,
      stdout: JSON.stringify({
        loggedIn: true,
        authMethod: 'claude.ai',
        apiProvider: 'firstParty',
        email: 'operator@example.com',
        subscriptionType: 'max',
      }),
      stderr: '',
    }));
    const manager = new ClaudeAuthManager({
      adapter: adapterFor([], run),
      runtimeHome: home,
      now: () => 1_700_000_000_000,
    });

    const status = await manager.getStatus();

    expect(status.connected).toBe(true);
    expect(status.email).toBe('operator@example.com');
    expect(status.subscriptionType).toBe('max');
    expect(status.runtimeHome).toBe(home);
    expect(status.credentialFile.exists).toBe(true);
    expect(JSON.stringify(status)).not.toContain('do-not-return');
    expect(run).toHaveBeenCalledWith(
      'claude',
      ['auth', 'status', '--json'],
      expect.objectContaining({ timeoutMs: 10_000 }),
    );
  });

  it('starts a Claude auth session, accepts the returned code, and verifies status without exposing the code', async () => {
    const proc = new FakeProcess();
    const run = vi.fn(async () => ({
      code: 0,
      stdout: JSON.stringify({
        loggedIn: true,
        authMethod: 'claude.ai',
        apiProvider: 'firstParty',
        email: 'operator@example.com',
        subscriptionType: 'max',
      }),
      stderr: '',
    }));
    const manager = new ClaudeAuthManager({
      adapter: adapterFor([proc], run),
      runtimeHome: '/runtime/home',
      sessionTimeoutMs: 30_000,
      startUrlTimeoutMs: 1_000,
      now: () => 1_700_000_000_000,
      idGenerator: () => 'auth_test',
    });

    const startedPromise = manager.startLogin();
    proc.writeStdout('If the browser did not open, visit: https://claude.com/cai/oauth/authorize?state=state_secret&code_challenge=challenge_secret\n');
    const started = await startedPromise;

    expect(started.sessionId).toBe('auth_test');
    expect(started.status).toBe('waiting_for_code');
    expect(started.loginUrl).toContain('https://claude.com/cai/oauth/authorize');
    expect(started.safeOutput).not.toContain('state_secret');
    expect(started.safeOutput).not.toContain('challenge_secret');

    const completedPromise = manager.completeLogin('auth_test', 'returned-browser-code');
    expect(proc.stdin.writes).toEqual(['returned-browser-code\n']);
    proc.writeStdout('Authenticated\n');
    proc.close(0);
    const completed = await completedPromise;

    expect(completed.status.connected).toBe(true);
    expect(JSON.stringify(completed)).not.toContain('returned-browser-code');
  });

  it('cancels a pending auth session and kills the CLI process', async () => {
    const proc = new FakeProcess();
    const manager = new ClaudeAuthManager({
      adapter: adapterFor([proc]),
      runtimeHome: '/runtime/home',
      startUrlTimeoutMs: 1_000,
      idGenerator: () => 'auth_cancel',
    });

    const startedPromise = manager.startLogin();
    proc.writeStdout('visit: https://claude.com/cai/oauth/authorize?state=abc\n');
    await startedPromise;

    const result = manager.cancelLogin('auth_cancel');

    expect(result.cancelled).toBe(true);
    expect(proc.killed).toBe(true);
    expect(manager.getPendingSession()).toBeNull();
  });
});
