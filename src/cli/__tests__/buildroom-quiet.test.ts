import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runBuildroomCli } from '../buildroom.js';

describe('buildroom CLI quiet output', () => {
  let root: string;
  const out: string[] = [];
  const err: string[] = [];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'anthroclaw-buildroom-cli-quiet-'));
    out.length = 0;
    err.length = 0;
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('suppresses successful text output when --quiet is used', async () => {
    await run(['init', '--root', root]);
    out.length = 0;

    await expect(run(['status', '--root', root, '--quiet'])).resolves.toBe(0);

    expect(out).toEqual([]);
    expect(err).toEqual([]);
  });

  it('does not suppress error output when --quiet is used', async () => {
    await run(['init', '--root', root]);
    out.length = 0;
    err.length = 0;

    await expect(run(['show', 'missing_20260512_docs', '--root', root, '--quiet'])).resolves.toBe(5);

    expect(out).toEqual([]);
    expect(err.join('\n')).toContain('Artifact not found: missing_20260512_docs');
  });

  it('lets --json take precedence over --quiet', async () => {
    await run(['init', '--root', root]);
    out.length = 0;

    await expect(run(['status', '--root', root, '--quiet', '--json'])).resolves.toBe(0);

    expect(err).toEqual([]);
    expect(JSON.parse(out[0])).toMatchObject({
      ok: true,
      command: 'status',
      roomId: 'anthroclaw-core',
    });
  });

  function run(argv: string[]): Promise<number> {
    return runBuildroomCli(argv, {
      stdout: (text) => out.push(text),
      stderr: (text) => err.push(text),
    });
  }
});
