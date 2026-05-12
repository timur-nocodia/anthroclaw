import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runBuildroomCli } from '../buildroom.js';

describe('buildroom CLI', () => {
  let root: string;
  const out: string[] = [];
  const err: string[] = [];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'anthroclaw-buildroom-cli-'));
    out.length = 0;
    err.length = 0;
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('initializes a manual approval room and reports status', async () => {
    await expect(
      run(['init', '--root', root, '--room', 'anthroclaw-core', '--operator', 'cli:user:local-operator']),
    ).resolves.toBe(0);

    expect(out.join('\n')).toContain('Buildroom initialized');
    expect(out.join('\n')).toContain('Mode: manual_approval');
    expect(out.join('\n')).toContain('External side effects: denied');

    out.length = 0;
    await expect(run(['status', '--root', root])).resolves.toBe(0);

    expect(out.join('\n')).toContain('Buildroom: anthroclaw-core');
    expect(out.join('\n')).toContain('Mode: manual_approval');
    expect(out.join('\n')).toContain('Kill switch: inactive');
    expect(out.join('\n')).toContain('Approved not built: 0');
  });

  it('refuses init when operator identity is invalid', async () => {
    await expect(
      run(['init', '--root', root, '--room', 'anthroclaw-core', '--operator', 'telegram_chat:-1003931616911']),
    ).resolves.toBe(3);

    expect(err.join('\n')).toContain('Telegram chat/thread route is not operator identity');
  });

  function run(argv: string[]): Promise<number> {
    return runBuildroomCli(argv, {
      stdout: (text) => out.push(text),
      stderr: (text) => err.push(text),
    });
  }
});
