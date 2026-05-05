import { existsSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

export interface ResolveFileTransferPathInput {
  requestedPath: string;
  roots: string[];
}

export interface ResolvedFileTransferPath {
  absolutePath: string;
  matchedRoot: string;
}

export function resolveFileTransferPath(input: ResolveFileTransferPathInput): ResolvedFileTransferPath {
  if (input.roots.length === 0) {
    throw new Error('file-transfer roots are empty');
  }
  const requested = resolve(input.requestedPath);
  const requestedReal = realpathForExistingOrParent(requested);

  for (const root of input.roots) {
    const rootAbs = resolve(root);
    const rootReal = existsSync(rootAbs) ? realpathSync.native(rootAbs) : rootAbs;
    const rel = relative(rootReal, requestedReal);
    if (rel === '' || (rel && !rel.startsWith('..') && !isAbsolute(rel))) {
      return { absolutePath: requestedReal, matchedRoot: rootReal };
    }
  }

  throw new Error(`path is outside allowed roots: ${input.requestedPath}`);
}

function realpathForExistingOrParent(path: string): string {
  if (existsSync(path)) return realpathSync.native(path);
  const parent = dirname(path);
  if (parent === path || !existsSync(parent)) return path;
  return join(realpathSync.native(parent), path.slice(parent.length + 1));
}
