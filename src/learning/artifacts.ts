import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { redactSecrets } from '../security/redact.js';

const DEFAULT_MAX_FILES = 32;
const DEFAULT_MAX_FILE_BYTES = 64 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 256 * 1024;
const DEFAULT_MAX_PROMPT_CHARS = 24_000;
const DEFAULT_MAX_SNIPPET_CHARS = 4_000;

export interface LearningArtifactLimits {
  maxFiles?: number;
  maxFileBytes?: number;
  maxTotalBytes?: number;
  maxPromptChars?: number;
  maxSnippetChars?: number;
}

export interface LearningArtifactFileInput {
  path: string;
  reason: string;
}

export interface LearningArtifactSnippetInput {
  id: string;
  title?: string;
  text: string;
  reason: string;
}

export interface ExportLearningArtifactsParams {
  dataDir: string;
  workspacePath: string;
  agentId: string;
  runId: string;
  files?: LearningArtifactFileInput[];
  snippets?: LearningArtifactSnippetInput[];
  limits?: LearningArtifactLimits;
  createdAt?: number;
}

export interface LearningArtifactManifestFile {
  sourcePath: string;
  artifactPath: string;
  contentHash: string;
  sizeBytes: number;
  reason: string;
}

export interface LearningArtifactManifestSnippet {
  id: string;
  title?: string;
  artifactPath: string;
  contentHash: string;
  sizeBytes: number;
  reason: string;
  truncated: boolean;
}

export interface LearningArtifactOmission {
  path: string;
  reason: string;
}

export interface LearningArtifactManifest {
  version: 1;
  agentId: string;
  runId: string;
  createdAt: number;
  files: LearningArtifactManifestFile[];
  snippets: LearningArtifactManifestSnippet[];
  omitted: LearningArtifactOmission[];
  promptContext: string;
}

export interface ExportLearningArtifactsResult {
  outputDir: string;
  manifestPath: string;
  manifest: LearningArtifactManifest;
}

export function exportLearningArtifacts(params: ExportLearningArtifactsParams): ExportLearningArtifactsResult {
  const limits = {
    maxFiles: params.limits?.maxFiles ?? DEFAULT_MAX_FILES,
    maxFileBytes: params.limits?.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
    maxTotalBytes: params.limits?.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES,
    maxPromptChars: params.limits?.maxPromptChars ?? DEFAULT_MAX_PROMPT_CHARS,
    maxSnippetChars: params.limits?.maxSnippetChars ?? DEFAULT_MAX_SNIPPET_CHARS,
  };
  const workspaceRoot = realpathSync.native(resolve(params.workspacePath));
  const outputDir = join(
    resolve(params.dataDir),
    'learning-artifacts',
    safePathSegment(params.agentId),
    safePathSegment(params.runId),
  );
  mkdirSync(outputDir, { recursive: true });

  const files: LearningArtifactManifestFile[] = [];
  const snippets: LearningArtifactManifestSnippet[] = [];
  const omitted: LearningArtifactOmission[] = [];
  let totalBytes = 0;

  for (const input of params.files ?? []) {
    if (files.length >= limits.maxFiles) {
      omitted.push({ path: input.path, reason: 'max_files_exceeded' });
      continue;
    }

    const resolved = resolveWorkspaceFile(workspaceRoot, input.path);
    if (!resolved) {
      omitted.push({ path: input.path, reason: 'outside_workspace' });
      continue;
    }

    const relativePath = toPortablePath(relative(workspaceRoot, resolved));
    const ignoredReason = getIgnoredPathReason(relativePath);
    if (ignoredReason) {
      omitted.push({ path: relativePath, reason: ignoredReason });
      continue;
    }

    if (!existsSync(resolved)) {
      omitted.push({ path: relativePath, reason: 'missing' });
      continue;
    }

    const stat = statSync(resolved);
    if (!stat.isFile()) {
      omitted.push({ path: relativePath, reason: 'not_file' });
      continue;
    }
    if (stat.size > limits.maxFileBytes) {
      omitted.push({ path: relativePath, reason: 'max_file_bytes_exceeded' });
      continue;
    }
    if (totalBytes + stat.size > limits.maxTotalBytes) {
      omitted.push({ path: relativePath, reason: 'max_total_bytes_exceeded' });
      continue;
    }

    const raw = readFileSync(resolved);
    if (isProbablyBinary(raw)) {
      omitted.push({ path: relativePath, reason: 'binary_or_media' });
      continue;
    }

    const redacted = redactSecrets(raw.toString('utf8'));
    const artifactPath = toPortablePath(join('files', relativePath));
    writeArtifact(outputDir, artifactPath, redacted);
    const sizeBytes = Buffer.byteLength(redacted);
    totalBytes += sizeBytes;
    files.push({
      sourcePath: relativePath,
      artifactPath,
      contentHash: sha256(redacted),
      sizeBytes,
      reason: input.reason,
    });
  }

  for (const snippet of params.snippets ?? []) {
    const redacted = redactSecrets(snippet.text);
    const truncated = redacted.length > limits.maxSnippetChars;
    const text = truncated ? redacted.slice(0, limits.maxSnippetChars) : redacted;
    const artifactPath = toPortablePath(join('snippets', `${safePathSegment(snippet.id)}.txt`));
    writeArtifact(outputDir, artifactPath, text);
    snippets.push({
      id: snippet.id,
      title: snippet.title,
      artifactPath,
      contentHash: sha256(text),
      sizeBytes: Buffer.byteLength(text),
      reason: snippet.reason,
      truncated,
    });
  }

  files.sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));
  snippets.sort((a, b) => a.id.localeCompare(b.id));
  omitted.sort((a, b) => `${a.path}:${a.reason}`.localeCompare(`${b.path}:${b.reason}`));

  const manifest: LearningArtifactManifest = {
    version: 1,
    agentId: params.agentId,
    runId: params.runId,
    createdAt: params.createdAt ?? Date.now(),
    files,
    snippets,
    omitted,
    promptContext: buildPromptContext(outputDir, files, snippets, limits.maxPromptChars),
  };
  const manifestPath = join(outputDir, 'manifest.json');
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return { outputDir, manifestPath, manifest };
}

function resolveWorkspaceFile(workspaceRoot: string, inputPath: string): string | null {
  if (inputPath.trim() === '') return null;
  const candidate = isAbsolute(inputPath)
    ? resolve(inputPath)
    : resolve(workspaceRoot, inputPath);
  if (!existsSync(candidate)) {
    const rel = relative(workspaceRoot, candidate);
    return isPathInside(rel) ? candidate : null;
  }
  const real = realpathSync.native(candidate);
  const rel = relative(workspaceRoot, real);
  return isPathInside(rel) ? real : null;
}

function isPathInside(relativePath: string): boolean {
  return relativePath !== ''
    && !relativePath.startsWith('..')
    && !isAbsolute(relativePath);
}

function getIgnoredPathReason(path: string): string | null {
  const parts = path.split('/');
  if (parts.includes('.git')) return 'ignored_git';
  if (parts.includes('node_modules')) return 'ignored_node_modules';
  if (parts.some((part) => part === 'dist' || part === 'build' || part === '.next' || part === 'coverage')) {
    return 'ignored_build_artifact';
  }
  const base = basename(path);
  if (base === '.env' || base.startsWith('.env.')) return 'ignored_env';
  return null;
}

function isProbablyBinary(buffer: Buffer): boolean {
  if (buffer.length === 0) return false;
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  if (sample.includes(0)) return true;
  let suspicious = 0;
  for (const byte of sample) {
    if (byte < 7 || (byte > 13 && byte < 32)) suspicious++;
  }
  return suspicious / sample.length > 0.1;
}

function writeArtifact(outputDir: string, artifactPath: string, text: string): void {
  const fullPath = join(outputDir, ...artifactPath.split('/'));
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, text, 'utf8');
}

function buildPromptContext(
  outputDir: string,
  files: LearningArtifactManifestFile[],
  snippets: LearningArtifactManifestSnippet[],
  maxChars: number,
): string {
  const sections: string[] = [];
  for (const file of files) {
    const text = readFileSync(join(outputDir, ...file.artifactPath.split('/')), 'utf8');
    sections.push(`## File: ${file.sourcePath}\nReason: ${file.reason}\n\n${text}`);
  }
  for (const snippet of snippets) {
    const text = readFileSync(join(outputDir, ...snippet.artifactPath.split('/')), 'utf8');
    sections.push(`## Snippet: ${snippet.title ?? snippet.id}\nReason: ${snippet.reason}\n\n${text}`);
  }
  const context = sections.join('\n\n---\n\n');
  return context.length > maxChars ? context.slice(0, maxChars) : context;
}

function safePathSegment(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || sha256(value).slice(0, 16);
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function toPortablePath(path: string): string {
  return sep === '/' ? path : path.split(sep).join('/');
}
