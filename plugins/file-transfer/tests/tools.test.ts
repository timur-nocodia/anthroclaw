import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileFetch } from '../src/tools/file-fetch.js';
import { dirList } from '../src/tools/dir-list.js';
import { fileWrite } from '../src/tools/file-write.js';

describe('file-transfer tools', () => {
  let root: string;
  let safeRoot: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'file-transfer-tools-'));
    safeRoot = join(root, 'safe');
    mkdirSync(safeRoot, { recursive: true });
    writeFileSync(join(safeRoot, 'a.txt'), 'hello', 'utf8');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('fetches a text file inside allowed roots', async () => {
    const result = await fileFetch({ path: join(safeRoot, 'a.txt') }, { roots: [safeRoot] });
    expect(result.text).toBe('hello');
  });

  it('lists a directory without leaking outside roots', async () => {
    const result = await dirList({ path: safeRoot }, { roots: [safeRoot] });
    expect(result.entries).toEqual([
      expect.objectContaining({ name: 'a.txt', type: 'file' }),
    ]);
  });

  it('writes only when explicitly enabled', async () => {
    await expect(fileWrite(
      { path: join(safeRoot, 'out.txt'), content: 'ok' },
      { roots: [safeRoot], allowWrite: false },
    )).rejects.toThrow(/write disabled/i);

    await fileWrite(
      { path: join(safeRoot, 'out.txt'), content: 'ok' },
      { roots: [safeRoot], allowWrite: true },
    );
    expect(existsSync(join(safeRoot, 'out.txt'))).toBe(true);
    expect(readFileSync(join(safeRoot, 'out.txt'), 'utf8')).toBe('ok');
  });
});
