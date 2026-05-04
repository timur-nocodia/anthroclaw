import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveImports } from '../system-prompt.js';
import { logger } from '../../logger.js';

// ──────────────────────────────────────────────────────────────────────────────
// Test fixtures
// ──────────────────────────────────────────────────────────────────────────────

let workspaceRoot: string;
let claudeMdPath: string;

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'system-prompt-test-'));
  claudeMdPath = join(workspaceRoot, 'CLAUDE.md');
});

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true });
});

function writeFile(rel: string, content: string): string {
  const abs = join(workspaceRoot, rel);
  const dir = abs.substring(0, abs.lastIndexOf('/'));
  if (dir && dir !== workspaceRoot) mkdirSync(dir, { recursive: true });
  writeFileSync(abs, content, 'utf-8');
  return abs;
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests numbered per plan §1.2
// ──────────────────────────────────────────────────────────────────────────────

describe('resolveImports — base cases', () => {
  // 1
  it('content without @-imports is returned unchanged', () => {
    const content = '# Title\n\nSome body text.\nLine three.';
    const out = resolveImports(content, claudeMdPath, { workspaceRoot });
    expect(out).toBe(content);
  });

  // 2
  it('single @./X.md import is inlined', () => {
    writeFile('SOUL.md', 'I am SOUL.');
    const content = 'before\n@./SOUL.md\nafter';
    const out = resolveImports(content, claudeMdPath, { workspaceRoot });
    expect(out).toBe('before\nI am SOUL.\nafter');
  });
});

describe('resolveImports — recursion', () => {
  // 3
  it('recursive A → B → C all inlined depth-first', () => {
    writeFile('A.md', 'A-start\n@./B.md\nA-end');
    writeFile('B.md', 'B-start\n@./C.md\nB-end');
    writeFile('C.md', 'C-only');
    const content = '@./A.md';
    const out = resolveImports(content, claudeMdPath, { workspaceRoot });
    expect(out).toBe('A-start\nB-start\nC-only\nB-end\nA-end');
  });

  // 4
  it('cycle A → B → A: first A inlined, second dropped silently', () => {
    writeFile('A.md', 'A-start\n@./B.md\nA-end');
    writeFile('B.md', 'B-start\n@./A.md\nB-end');
    const content = '@./A.md';
    const out = resolveImports(content, claudeMdPath, { workspaceRoot });
    // First A inlined, second @./A.md from inside B is dropped (line removed).
    expect(out).toBe('A-start\nB-start\nB-end\nA-end');
  });

  // 5
  it('diamond A → {B,C}, B → D, C → D: D inlined under B, dropped under C', () => {
    writeFile('A.md', '@./B.md\n@./C.md');
    writeFile('B.md', 'B-pre\n@./D.md\nB-post');
    writeFile('C.md', 'C-pre\n@./D.md\nC-post');
    writeFile('D.md', 'D-content');
    const content = '@./A.md';
    const out = resolveImports(content, claudeMdPath, { workspaceRoot });
    // D appears under B; under C the @./D.md line is dropped (de-dupe).
    expect(out).toBe('B-pre\nD-content\nB-post\nC-pre\nC-post');
  });

  // 6
  it('depth chain > 5 terminates, deepest line dropped', () => {
    // Chain: top → 1 → 2 → 3 → 4 → 5 → 6 . `top` content has @./1.md
    // (depth 1). 1.md → @./2.md (depth 2). At depth 5 we are inlining 5.md;
    // its `@./6.md` line would push depth to 6 → exceeded → dropped.
    writeFile('1.md', 'd1\n@./2.md');
    writeFile('2.md', 'd2\n@./3.md');
    writeFile('3.md', 'd3\n@./4.md');
    writeFile('4.md', 'd4\n@./5.md');
    writeFile('5.md', 'd5\n@./6.md');
    writeFile('6.md', 'd6');
    const content = '@./1.md';
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as any);
    try {
      const out = resolveImports(content, claudeMdPath, { workspaceRoot });
      expect(out).toBe('d1\nd2\nd3\nd4\nd5');
      // At least one warn with reason 'depth' must have fired.
      const sawDepth = warnSpy.mock.calls.some(
        (call) =>
          typeof call[0] === 'object' &&
          call[0] !== null &&
          (call[0] as Record<string, unknown>).reason === 'depth',
      );
      expect(sawDepth).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('respects custom maxDepth = 1: deeper imports are dropped', () => {
    writeFile('A.md', 'A-pre\n@./B.md\nA-post');
    writeFile('B.md', 'B-content');
    const content = '@./A.md';
    const out = resolveImports(content, claudeMdPath, {
      workspaceRoot,
      maxDepth: 1,
    });
    // A inlined at depth 1; @./B.md inside A would push to depth 2 → dropped.
    expect(out).toBe('A-pre\nA-post');
  });
});

describe('resolveImports — path policy', () => {
  // 7
  it('missing @./nonexistent.md is preserved as-is', () => {
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => undefined as any);
    try {
      const content = 'before\n@./nonexistent.md\nafter';
      const out = resolveImports(content, claudeMdPath, { workspaceRoot });
      expect(out).toBe(content);
      const sawMissing = infoSpy.mock.calls.some(
        (call) =>
          typeof call[0] === 'object' &&
          call[0] !== null &&
          (call[0] as Record<string, unknown>).reason === 'missing',
      );
      expect(sawMissing).toBe(true);
    } finally {
      infoSpy.mockRestore();
    }
  });

  // 8
  it('path escape @../../etc/passwd is preserved', () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as any);
    try {
      const content = 'before\n@../../etc/passwd\nafter';
      const out = resolveImports(content, claudeMdPath, { workspaceRoot });
      expect(out).toBe(content);
      const sawEscape = warnSpy.mock.calls.some(
        (call) =>
          typeof call[0] === 'object' &&
          call[0] !== null &&
          (call[0] as Record<string, unknown>).reason === 'escape',
      );
      expect(sawEscape).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  // 9
  it('absolute path @/etc/passwd is preserved', () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as any);
    try {
      const content = 'before\n@/etc/passwd\nafter';
      const out = resolveImports(content, claudeMdPath, { workspaceRoot });
      expect(out).toBe(content);
      const sawAbsolute = warnSpy.mock.calls.some(
        (call) =>
          typeof call[0] === 'object' &&
          call[0] !== null &&
          (call[0] as Record<string, unknown>).reason === 'absolute',
      );
      expect(sawAbsolute).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  // 10
  it('URL-like @http://example.com/x is preserved', () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as any);
    try {
      const content = 'before\n@http://evil.example.com/x\nafter';
      const out = resolveImports(content, claudeMdPath, { workspaceRoot });
      expect(out).toBe(content);
      const sawUrl = warnSpy.mock.calls.some(
        (call) =>
          typeof call[0] === 'object' &&
          call[0] !== null &&
          (call[0] as Record<string, unknown>).reason === 'url',
      );
      expect(sawUrl).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('URL-like @https://… and @file://… are preserved', () => {
    const content1 = '@https://example.com/x';
    const out1 = resolveImports(content1, claudeMdPath, { workspaceRoot });
    expect(out1).toBe(content1);
    const content2 = '@file:///etc/passwd';
    const out2 = resolveImports(content2, claudeMdPath, { workspaceRoot });
    expect(out2).toBe(content2);
  });

  // 11
  it('symlink-escape (workspace/link → /tmp outside) is preserved', () => {
    // Create a target dir outside the workspace, then symlink into workspace.
    const outsideRoot = mkdtempSync(join(tmpdir(), 'system-prompt-outside-'));
    try {
      const outsideFile = join(outsideRoot, 'secret.md');
      writeFileSync(outsideFile, 'SECRET BODY', 'utf-8');
      const linkPath = join(workspaceRoot, 'link.md');
      symlinkSync(outsideFile, linkPath);
      const content = 'before\n@./link.md\nafter';
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as any);
      try {
        const out = resolveImports(content, claudeMdPath, { workspaceRoot });
        // Line preserved, symlinked secret body must NOT appear in output.
        expect(out).toBe(content);
        expect(out).not.toContain('SECRET BODY');
        const sawEscape = warnSpy.mock.calls.some(
          (call) =>
            typeof call[0] === 'object' &&
            call[0] !== null &&
            (call[0] as Record<string, unknown>).reason === 'escape',
        );
        expect(sawEscape).toBe(true);
      } finally {
        warnSpy.mockRestore();
      }
    } finally {
      rmSync(outsideRoot, { recursive: true, force: true });
    }
  });

  // 12
  it('file > 1 MB is preserved (oversize)', () => {
    // 1.1 MB file.
    const big = 'x'.repeat(1024 * 1024 + 100 * 1024);
    writeFile('BIG.md', big);
    const content = 'before\n@./BIG.md\nafter';
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as any);
    try {
      const out = resolveImports(content, claudeMdPath, { workspaceRoot });
      expect(out).toBe(content);
      expect(out).not.toContain('xxxxxx');
      const sawOversize = warnSpy.mock.calls.some(
        (call) =>
          typeof call[0] === 'object' &&
          call[0] !== null &&
          (call[0] as Record<string, unknown>).reason === 'oversize',
      );
      expect(sawOversize).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('resolveImports — formatting', () => {
  // 13
  it('whitespace variations and CRLF endings resolve correctly', () => {
    writeFile('X.md', 'X-body');
    // Mix of leading/trailing whitespace and CRLF newlines.
    const content = 'before\r\n  @./X.md  \r\nafter';
    const out = resolveImports(content, claudeMdPath, { workspaceRoot });
    // Line endings: import line is replaced with X-body. Surrounding CRLF
    // is preserved on the surviving lines.
    // We split on \n but original \r is preserved on each non-import line.
    expect(out).toBe('before\r\nX-body\r\nafter');
  });

  // 14
  it('non-import lines mentioning @ are preserved verbatim', () => {
    writeFile('X.md', 'X-body');
    const content = [
      'Use @username syntax',
      '# @./X.md',
      'Read @./file.md for context',
      '@./a.md @./b.md',
      'Email: foo@bar.com',
    ].join('\n');
    const out = resolveImports(content, claudeMdPath, { workspaceRoot });
    expect(out).toBe(content);
  });

  // 15
  it('empty imported file → @<path> line replaced with empty string', () => {
    writeFile('EMPTY.md', '');
    const content = 'before\n@./EMPTY.md\nafter';
    const out = resolveImports(content, claudeMdPath, { workspaceRoot });
    // The import line vanishes; "before" and "after" remain on adjacent lines.
    expect(out).toBe('before\n\nafter');
  });

  it('preserves trailing-newline policy: no trailing \\n if input had none', () => {
    writeFile('X.md', 'X-body');
    const content = 'before\n@./X.md';
    const out = resolveImports(content, claudeMdPath, { workspaceRoot });
    expect(out.endsWith('\n')).toBe(false);
    expect(out).toBe('before\nX-body');
  });

  it('preserves trailing newline if input had one', () => {
    writeFile('X.md', 'X-body');
    const content = 'before\n@./X.md\n';
    const out = resolveImports(content, claudeMdPath, { workspaceRoot });
    expect(out).toBe('before\nX-body\n');
  });
});
