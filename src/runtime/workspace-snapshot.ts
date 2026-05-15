import { constants } from 'node:fs';
import {
  access,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { RuntimeRewindFilesOptions, RuntimeRewindFilesResult } from './types.js';

export interface WorkspaceSnapshotOptions {
  maxFiles?: number;
  maxBytes?: number;
  excludeDirs?: string[];
}

export interface WorkspaceSnapshot {
  cwd: string;
  files: Map<string, Buffer>;
  incomplete: boolean;
  limitReason?: string;
}

const DEFAULT_MAX_FILES = 2_000;
const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;
const DEFAULT_EXCLUDED_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  '.DS_Store',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.turbo',
  '.cache',
]);

export async function captureWorkspaceSnapshot(
  cwd: string | undefined,
  options: WorkspaceSnapshotOptions = {},
): Promise<WorkspaceSnapshot | undefined> {
  if (!cwd) return undefined;

  const root = resolve(cwd);
  try {
    await access(root, constants.R_OK);
    const rootStat = await stat(root);
    if (!rootStat.isDirectory()) return undefined;
  } catch {
    return undefined;
  }

  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const excludeDirs = new Set([...DEFAULT_EXCLUDED_DIRS, ...(options.excludeDirs ?? [])]);
  const files = new Map<string, Buffer>();
  let totalBytes = 0;
  let incomplete = false;
  let limitReason: string | undefined;

  const visit = async (dir: string): Promise<void> => {
    if (incomplete) return;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (incomplete) return;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (excludeDirs.has(entry.name)) continue;
        await visit(join(dir, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;

      const absolutePath = join(dir, entry.name);
      const relativePath = normalizeRelativePath(root, absolutePath);
      const content = await readFile(absolutePath);
      if (files.size + 1 > maxFiles) {
        incomplete = true;
        limitReason = `Workspace snapshot exceeded ${maxFiles} files.`;
        return;
      }
      if (totalBytes + content.byteLength > maxBytes) {
        incomplete = true;
        limitReason = `Workspace snapshot exceeded ${maxBytes} bytes.`;
        return;
      }
      files.set(relativePath, content);
      totalBytes += content.byteLength;
    }
  };

  await visit(root);
  return {
    cwd: root,
    files,
    incomplete,
    limitReason,
  };
}

export async function rewindWorkspaceSnapshot(
  snapshot: WorkspaceSnapshot | undefined,
  options: RuntimeRewindFilesOptions = {},
): Promise<RuntimeRewindFilesResult> {
  if (!snapshot) {
    return {
      canRewind: false,
      error: 'No workspace snapshot is available for this runtime handle.',
    };
  }
  if (snapshot.incomplete) {
    return {
      canRewind: false,
      error: snapshot.limitReason ?? 'Workspace snapshot is incomplete.',
    };
  }

  const currentFiles = await listWorkspaceFiles(snapshot.cwd);
  const changed = await diffSnapshot(snapshot, currentFiles);
  if (options.dryRun) {
    return {
      canRewind: true,
      filesChanged: changed.filesChanged,
      insertions: changed.filesToRestore,
      deletions: changed.filesToDelete,
    };
  }

  for (const relativePath of changed.createdFiles) {
    await rm(join(snapshot.cwd, relativePath), { force: true });
  }
  for (const relativePath of changed.restoredFiles) {
    const absolutePath = join(snapshot.cwd, relativePath);
    const content = snapshot.files.get(relativePath);
    if (!content) continue;
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content);
  }

  return {
    canRewind: true,
    filesChanged: changed.filesChanged,
    insertions: changed.filesToRestore,
    deletions: changed.filesToDelete,
  };
}

async function diffSnapshot(snapshot: WorkspaceSnapshot, currentFiles: Map<string, Buffer>) {
  const createdFiles: string[] = [];
  const restoredFiles: string[] = [];

  for (const relativePath of currentFiles.keys()) {
    if (!snapshot.files.has(relativePath)) {
      createdFiles.push(relativePath);
    }
  }

  for (const [relativePath, content] of snapshot.files.entries()) {
    const current = currentFiles.get(relativePath);
    if (!current || !current.equals(content)) {
      restoredFiles.push(relativePath);
    }
  }

  const filesChanged = Array.from(new Set([...createdFiles, ...restoredFiles])).sort();
  return {
    createdFiles: createdFiles.sort(),
    restoredFiles: restoredFiles.sort(),
    filesChanged,
    filesToDelete: createdFiles.length,
    filesToRestore: restoredFiles.length,
  };
}

async function listWorkspaceFiles(cwd: string): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();
  const visit = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const absolutePath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (DEFAULT_EXCLUDED_DIRS.has(entry.name)) continue;
        await visit(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      files.set(normalizeRelativePath(cwd, absolutePath), await readFile(absolutePath));
    }
  };
  await visit(cwd);
  return files;
}

function normalizeRelativePath(root: string, absolutePath: string): string {
  return relative(root, absolutePath).split(sep).join('/');
}
