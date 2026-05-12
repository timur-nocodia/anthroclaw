import { posix } from 'node:path';

export type PathPolicyViolationReason = 'blocked_path' | 'not_allowed' | 'path_escape';

export interface PathPolicyViolation {
  path: string;
  reason: PathPolicyViolationReason;
  matchedPattern?: string;
}

export interface EvaluatePathPolicyOptions {
  paths: string[];
  allowedPaths: string[];
  blockedPaths: string[];
}

export interface PathPolicyResult {
  allowed: boolean;
  checkedPaths: string[];
  blockedPaths: string[];
  violations: PathPolicyViolation[];
}

export class PathPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathPolicyError';
  }
}

export function normalizeRepoPath(path: string): string {
  const slashPath = path.replaceAll('\\', '/');
  if (slashPath.startsWith('/') || /^[A-Za-z]:\//.test(slashPath)) {
    throw new PathPolicyError(`Absolute paths are not allowed: ${path}`);
  }

  const normalized = posix.normalize(slashPath);
  if (normalized === '..' || normalized.startsWith('../')) {
    throw new PathPolicyError(`Path escapes repository root: ${path}`);
  }

  return normalized === '.' ? '' : normalized.replace(/^\.\//, '');
}

export function evaluatePathPolicy(opts: EvaluatePathPolicyOptions): PathPolicyResult {
  const checkedPaths: string[] = [];
  const blockedPaths: string[] = [];
  const violations: PathPolicyViolation[] = [];

  for (const rawPath of opts.paths) {
    let path: string;
    try {
      path = normalizeRepoPath(rawPath);
    } catch {
      violations.push({ path: rawPath, reason: 'path_escape' });
      continue;
    }

    checkedPaths.push(path);
    const blockedPattern = opts.blockedPaths.find((pattern) => matchesGlob(path, pattern));
    if (blockedPattern) {
      blockedPaths.push(path);
      violations.push({ path, reason: 'blocked_path', matchedPattern: blockedPattern });
      continue;
    }

    const allowedPattern = opts.allowedPaths.find((pattern) => matchesGlob(path, pattern));
    if (!allowedPattern) {
      violations.push({ path, reason: 'not_allowed' });
    }
  }

  return {
    allowed: violations.length === 0,
    checkedPaths,
    blockedPaths,
    violations,
  };
}

function matchesGlob(path: string, pattern: string): boolean {
  return globToRegExp(normalizeRepoPath(pattern)).test(path);
}

function globToRegExp(glob: string): RegExp {
  let source = '^';
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i];
    const next = glob[i + 1];

    if (char === '*' && next === '*') {
      source += '.*';
      i += 1;
    } else if (char === '*') {
      source += '[^/]*';
    } else {
      source += escapeRegExp(char);
    }
  }

  source += '$';
  return new RegExp(source);
}

function escapeRegExp(char: string | undefined): string {
  if (!char) return '';
  return /[\\^$+?.()|[\]{}]/.test(char) ? `\\${char}` : char;
}

