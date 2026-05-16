import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { isDirOrDirSymlink } from '../gateway.js';

describe('isDirOrDirSymlink — agent discovery accepts symlinked dirs', () => {
  let root: string;
  let realAgentsDir: string;
  let projectedAgentsDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'discovery-symlink-'));
    realAgentsDir = join(root, 'real');
    projectedAgentsDir = join(root, 'projected');
    mkdirSync(join(realAgentsDir, 'cloned-agent'), { recursive: true });
    mkdirSync(projectedAgentsDir);
    // file
    writeFileSync(join(projectedAgentsDir, 'plain-file'), 'x');
    // real dir
    mkdirSync(join(projectedAgentsDir, 'real-dir'));
    // symlink → dir (this is what `agents/<id> -> ../anthroclaw-vibe-agents/...` looks like)
    symlinkSync(join(realAgentsDir, 'cloned-agent'), join(projectedAgentsDir, 'symlink-to-dir'));
    // symlink → file (must NOT be classified as dir)
    symlinkSync(join(projectedAgentsDir, 'plain-file'), join(projectedAgentsDir, 'symlink-to-file'));
    // broken symlink (must NOT be classified as dir, must not throw)
    symlinkSync(join(realAgentsDir, 'does-not-exist'), join(projectedAgentsDir, 'broken-symlink'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('classifies real dirs, dir-symlinks, file-symlinks, and broken symlinks correctly', () => {
    const entries = readdirSync(projectedAgentsDir, { withFileTypes: true });
    const classified = Object.fromEntries(
      entries.map((e) => [e.name, isDirOrDirSymlink(e, projectedAgentsDir)] as const),
    );
    expect(classified).toEqual({
      'plain-file': false,
      'real-dir': true,
      'symlink-to-dir': true,        // the case agent discovery needs
      'symlink-to-file': false,
      'broken-symlink': false,        // must not throw on missing target
    });
  });
});
