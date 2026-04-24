import { mkdir, readdir, readFile, rm, stat, appendFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type {
  SessionKey,
  SessionStore,
  SessionStoreEntry,
} from '@anthropic-ai/claude-agent-sdk';

const MAIN_TRANSCRIPT_FILE = 'main.jsonl';
const TRANSCRIPT_EXT = '.jsonl';

function encodeSegment(value: string): string {
  return Buffer.from(value, 'utf-8').toString('base64url');
}

function decodeSegment(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf-8');
}

function entryFileName(key: SessionKey): string {
  if (!key.subpath) return MAIN_TRANSCRIPT_FILE;
  return `${encodeSegment(key.subpath)}${TRANSCRIPT_EXT}`;
}

function sessionDir(rootDir: string, key: Pick<SessionKey, 'projectKey' | 'sessionId'>): string {
  return join(rootDir, encodeSegment(key.projectKey), encodeSegment(key.sessionId));
}

function entryPath(rootDir: string, key: SessionKey): string {
  return join(sessionDir(rootDir, key), entryFileName(key));
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

export class FileSessionStore implements SessionStore {
  constructor(readonly rootDir: string) {}

  async append(key: SessionKey, entries: SessionStoreEntry[]): Promise<void> {
    if (entries.length === 0) return;

    const target = entryPath(this.rootDir, key);
    await mkdir(dirname(target), { recursive: true });
    const payload = entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n';
    await appendFile(target, payload, 'utf-8');
  }

  async load(key: SessionKey): Promise<SessionStoreEntry[] | null> {
    const target = entryPath(this.rootDir, key);
    if (!await pathExists(target)) return null;

    const raw = await readFile(target, 'utf-8');
    const entries: SessionStoreEntry[] = [];

    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      entries.push(JSON.parse(trimmed) as SessionStoreEntry);
    }

    return entries;
  }

  async listSessions(projectKey: string): Promise<Array<{ sessionId: string; mtime: number }>> {
    const projectDir = join(this.rootDir, encodeSegment(projectKey));
    if (!await pathExists(projectDir)) return [];

    const entries = await readdir(projectDir, { withFileTypes: true });
    const sessions: Array<{ sessionId: string; mtime: number }> = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const mainPath = join(projectDir, entry.name, MAIN_TRANSCRIPT_FILE);
      if (!await pathExists(mainPath)) continue;

      const info = await stat(mainPath);
      sessions.push({
        sessionId: decodeSegment(entry.name),
        mtime: info.mtimeMs,
      });
    }

    return sessions.sort((a, b) => b.mtime - a.mtime);
  }

  async delete(key: SessionKey): Promise<void> {
    if (key.subpath) {
      await rm(entryPath(this.rootDir, key), { force: true });
      return;
    }

    await rm(sessionDir(this.rootDir, key), { recursive: true, force: true });
  }

  async listSubkeys(key: { projectKey: string; sessionId: string }): Promise<string[]> {
    const dir = sessionDir(this.rootDir, key);
    if (!await pathExists(dir)) return [];

    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => name !== MAIN_TRANSCRIPT_FILE && name.endsWith(TRANSCRIPT_EXT))
      .map((name) => decodeSegment(name.slice(0, -TRANSCRIPT_EXT.length)));
  }
}
