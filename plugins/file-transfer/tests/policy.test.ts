import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { realpathSync } from 'node:fs';
import { resolveFileTransferPath } from '../src/policy.js';

describe('file-transfer policy', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'file-transfer-policy-'));
    mkdirSync(join(root, 'safe'), { recursive: true });
    writeFileSync(join(root, 'safe', 'a.txt'), 'hello', 'utf8');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('allows paths inside configured roots', () => {
    const resolved = resolveFileTransferPath({
      requestedPath: join(root, 'safe', 'a.txt'),
      roots: [join(root, 'safe')],
    });

    expect(resolved.absolutePath).toBe(realpathSync.native(join(root, 'safe', 'a.txt')));
  });

  it('rejects paths outside configured roots', () => {
    expect(() => resolveFileTransferPath({
      requestedPath: join(root, 'outside.txt'),
      roots: [join(root, 'safe')],
    })).toThrow(/outside allowed roots/i);
  });

  it('rejects traversal through symlinks or parent segments', () => {
    expect(() => resolveFileTransferPath({
      requestedPath: join(root, 'safe', '..', 'outside.txt'),
      roots: [join(root, 'safe')],
    })).toThrow(/outside allowed roots/i);
  });
});
