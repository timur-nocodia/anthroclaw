import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runHeartbeatTaskScript } from '../script.js';

const tmpDirs: string[] = [];

function makeWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'anthroclaw-heartbeat-script-'));
  tmpDirs.push(dir);
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('runHeartbeatTaskScript', () => {
  it('runs workspace-local JavaScript scripts and strips wake gate lines', async () => {
    const workspace = makeWorkspace();
    writeFileSync(join(workspace, 'scripts', 'check.js'), `
console.log('metric changed');
console.log(JSON.stringify({ wakeAgent: true }));
`, 'utf-8');

    const result = await runHeartbeatTaskScript({
      workspacePath: workspace,
      script: 'scripts/check.js',
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('metric changed');
    expect(result.wakeAgent).toBe(true);
  });

  it('returns wakeAgent=false from the final stdout JSON line', async () => {
    const workspace = makeWorkspace();
    writeFileSync(join(workspace, 'scripts', 'quiet.js'), `
console.log('no changes');
console.log(JSON.stringify({ wakeAgent: false }));
`, 'utf-8');

    const result = await runHeartbeatTaskScript({
      workspacePath: workspace,
      script: 'scripts/quiet.js',
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('no changes');
    expect(result.wakeAgent).toBe(false);
  });

  it('rejects paths that escape the workspace', async () => {
    const workspace = makeWorkspace();
    const result = await runHeartbeatTaskScript({
      workspacePath: workspace,
      script: '../outside.js',
    });

    expect(result.exitCode).toBe(1);
    expect(result.error).toMatch(/workspace|not found/);
  });

  it('returns stderr and nonzero exit status without throwing', async () => {
    const workspace = makeWorkspace();
    writeFileSync(join(workspace, 'scripts', 'fail.js'), `
console.error('metric backend unavailable');
process.exit(7);
`, 'utf-8');

    const result = await runHeartbeatTaskScript({
      workspacePath: workspace,
      script: 'scripts/fail.js',
    });

    expect(result.exitCode).toBe(7);
    expect(result.stderr).toContain('metric backend unavailable');
    expect(result.error).toBeTruthy();
  });

  it('times out long-running scripts', async () => {
    const workspace = makeWorkspace();
    writeFileSync(join(workspace, 'scripts', 'slow.js'), `
setTimeout(() => console.log('late'), 1000);
`, 'utf-8');

    const result = await runHeartbeatTaskScript({
      workspacePath: workspace,
      script: 'scripts/slow.js',
      timeoutMs: 25,
    });

    expect(result.exitCode).toBe(1);
    expect(result.timedOut).toBe(true);
    expect(result.error).toMatch(/timed out/);
  });
});
