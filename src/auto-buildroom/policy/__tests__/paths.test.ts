import { describe, expect, it } from 'vitest';
import { evaluatePathPolicy, normalizeRepoPath, PathPolicyError } from '../paths.js';

describe('Auto-Buildroom path policy', () => {
  it('normalizes repository paths without allowing traversal escape', () => {
    expect(normalizeRepoPath('docs/Auto-Buildroom/../guide.md')).toBe('docs/guide.md');
    expect(normalizeRepoPath('docs\\Auto-Buildroom\\guide.md')).toBe(
      'docs/Auto-Buildroom/guide.md',
    );
    expect(() => normalizeRepoPath('../config.yml')).toThrow(PathPolicyError);
  });

  it('allows paths matching allowed globs', () => {
    const result = evaluatePathPolicy({
      paths: ['docs/Auto-Buildroom/00-index.md'],
      allowedPaths: ['docs/Auto-Buildroom/**'],
      blockedPaths: ['.env', 'agents/**'],
    });

    expect(result.allowed).toBe(true);
    expect(result.checkedPaths).toEqual(['docs/Auto-Buildroom/00-index.md']);
    expect(result.violations).toEqual([]);
  });

  it('rejects blocked paths even when they also match allowed globs', () => {
    const result = evaluatePathPolicy({
      paths: ['agents/example/AGENTS.md'],
      allowedPaths: ['**'],
      blockedPaths: ['agents/**'],
    });

    expect(result.allowed).toBe(false);
    expect(result.violations).toMatchObject([
      {
        path: 'agents/example/AGENTS.md',
        reason: 'blocked_path',
        matchedPattern: 'agents/**',
      },
    ]);
  });

  it('rejects paths outside the allowed set', () => {
    const result = evaluatePathPolicy({
      paths: ['src/index.ts'],
      allowedPaths: ['docs/**', 'tests/fixtures/**'],
      blockedPaths: ['.env'],
    });

    expect(result.allowed).toBe(false);
    expect(result.violations).toMatchObject([
      {
        path: 'src/index.ts',
        reason: 'not_allowed',
      },
    ]);
  });

  it('rejects empty allowed paths for mutation checks', () => {
    const result = evaluatePathPolicy({
      paths: ['docs/guide.md'],
      allowedPaths: [],
      blockedPaths: [],
    });

    expect(result.allowed).toBe(false);
    expect(result.violations[0]?.reason).toBe('not_allowed');
  });
});

