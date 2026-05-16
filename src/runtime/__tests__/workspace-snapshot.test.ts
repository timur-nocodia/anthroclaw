import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  captureWorkspaceSnapshot,
  rewindWorkspaceSnapshot,
} from '../workspace-snapshot.js';

describe('workspace snapshot rewind', () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('restores modified and deleted files and removes created files', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'workspace-snapshot-'));
    tmpDirs.push(cwd);
    mkdirSync(join(cwd, 'src'));
    writeFileSync(join(cwd, 'src', 'kept.txt'), 'old');
    writeFileSync(join(cwd, 'deleted.txt'), 'before');

    const snapshot = await captureWorkspaceSnapshot(cwd);

    writeFileSync(join(cwd, 'src', 'kept.txt'), 'new');
    writeFileSync(join(cwd, 'created.txt'), 'created');
    rmSync(join(cwd, 'deleted.txt'));

    await expect(rewindWorkspaceSnapshot(snapshot, { dryRun: true })).resolves.toMatchObject({
      canRewind: true,
      filesChanged: ['created.txt', 'deleted.txt', 'src/kept.txt'],
      insertions: 2,
      deletions: 1,
    });
    expect(readFileSync(join(cwd, 'src', 'kept.txt'), 'utf8')).toBe('new');

    await expect(rewindWorkspaceSnapshot(snapshot, { dryRun: false })).resolves.toMatchObject({
      canRewind: true,
      filesChanged: ['created.txt', 'deleted.txt', 'src/kept.txt'],
      insertions: 2,
      deletions: 1,
    });
    expect(readFileSync(join(cwd, 'src', 'kept.txt'), 'utf8')).toBe('old');
    expect(readFileSync(join(cwd, 'deleted.txt'), 'utf8')).toBe('before');
    expect(() => readFileSync(join(cwd, 'created.txt'), 'utf8')).toThrow();
  });

  it('refuses incomplete snapshots instead of partially rewinding a workspace', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'workspace-snapshot-limit-'));
    tmpDirs.push(cwd);
    writeFileSync(join(cwd, 'a.txt'), 'a');
    writeFileSync(join(cwd, 'b.txt'), 'b');

    const snapshot = await captureWorkspaceSnapshot(cwd, { maxFiles: 1 });

    await expect(rewindWorkspaceSnapshot(snapshot, { dryRun: false })).resolves.toMatchObject({
      canRewind: false,
      error: 'Workspace snapshot exceeded 1 files.',
    });
  });
});
