import { FileSessionStore } from '../sdk/session-store.js';
import { TranscriptIndex, type TranscriptSessionResult } from './transcript-index.js';

interface SessionStoreEntry {
  type: string;
  uuid?: string;
  timestamp?: string;
  message?: unknown;
  [k: string]: unknown;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function extractText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((block) => {
        if (typeof block === 'string') return block;
        const record = asRecord(block);
        if (typeof record.text === 'string') return record.text;
        if (typeof record.content === 'string') return record.content;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }

  const record = asRecord(value);
  if (typeof record.text === 'string') return record.text;
  if (typeof record.content === 'string') return record.content;
  return '';
}

function normalizeTranscriptEntries(entries: SessionStoreEntry[]): Array<{
  role: string;
  timestamp: string;
  text: string;
}> {
  const snippets: Array<{ role: string; timestamp: string; text: string }> = [];

  for (const entry of entries) {
    if (entry.type !== 'user' && entry.type !== 'assistant') continue;

    const payload = asRecord(entry.message);
    const text = extractText(payload.content)
      || extractText(payload.message)
      || extractText(payload)
      || '';
    const trimmed = text.trim();
    if (!trimmed) continue;

    snippets.push({
      role: entry.type,
      timestamp: typeof entry.timestamp === 'string' ? entry.timestamp : '',
      text: trimmed,
    });
  }

  return snippets;
}

export interface SessionSearchServiceOptions {
  projectKey: string;
  sessionStore: FileSessionStore;
  transcriptIndex: TranscriptIndex;
  summarizeSession?: (request: SessionSummaryRequest) => Promise<string | null>;
}

export interface SessionSummaryRequest {
  query: string;
  sessionId: string;
  snippets: TranscriptSessionResult['snippets'];
  transcript: Array<{
    role: string;
    timestamp: string;
    text: string;
  }>;
}

export interface SessionSearchSummaryResult extends TranscriptSessionResult {
  summary?: string;
}

const MAX_TRANSCRIPT_CHARS = 80_000;

function truncateTranscriptAroundSnippets(
  transcript: SessionSummaryRequest['transcript'],
  snippets: TranscriptSessionResult['snippets'],
): SessionSummaryRequest['transcript'] {
  const formatted = transcript.map((entry) => `[${entry.role}] ${entry.timestamp}\n${entry.text}`).join('\n\n');
  if (formatted.length <= MAX_TRANSCRIPT_CHARS) return transcript;

  const snippetNeedles = snippets
    .map((snippet) => snippet.text.slice(0, 160).trim())
    .filter(Boolean);
  const firstHit = snippetNeedles
    .map((needle) => formatted.indexOf(needle))
    .find((index) => index >= 0) ?? 0;

  const start = Math.max(0, firstHit - Math.floor(MAX_TRANSCRIPT_CHARS * 0.25));
  const windowText = formatted.slice(start, start + MAX_TRANSCRIPT_CHARS);
  return [{
    role: 'transcript',
    timestamp: '',
    text: `${start > 0 ? '[earlier transcript truncated]\n\n' : ''}${windowText}${start + MAX_TRANSCRIPT_CHARS < formatted.length ? '\n\n[later transcript truncated]' : ''}`,
  }];
}

export class SessionSearchService {
  constructor(private readonly options: SessionSearchServiceOptions) {}

  private async ensureIndexed(): Promise<void> {
    const sessions = await this.options.sessionStore.listSessions(this.options.projectKey);

    for (const session of sessions) {
      const current = this.options.transcriptIndex.getSessionMetadata(session.sessionId);
      if (current && current.lastModified >= session.mtime) continue;

      const entries = await this.options.sessionStore.load({
        projectKey: this.options.projectKey,
        sessionId: session.sessionId,
      }) as SessionStoreEntry[] | null;
      if (!entries) continue;

      const snippets = normalizeTranscriptEntries(entries);
      this.options.transcriptIndex.indexSession({
        sessionId: session.sessionId,
        lastModified: session.mtime,
        snippets,
      });
    }
  }

  async search(query: string, maxSessions = 3, maxSnippetsPerSession = 2): Promise<TranscriptSessionResult[]> {
    await this.ensureIndexed();
    return this.options.transcriptIndex.search(query, maxSessions, maxSnippetsPerSession);
  }

  private async loadTranscript(sessionId: string): Promise<SessionSummaryRequest['transcript']> {
    const entries = await this.options.sessionStore.load({
      projectKey: this.options.projectKey,
      sessionId,
    }) as SessionStoreEntry[] | null;

    return entries ? normalizeTranscriptEntries(entries) : [];
  }

  async searchWithSummaries(
    query: string,
    maxSessions = 3,
    maxSnippetsPerSession = 2,
  ): Promise<SessionSearchSummaryResult[]> {
    const results = await this.search(query, maxSessions, maxSnippetsPerSession);
    if (!this.options.summarizeSession || results.length === 0) return results;

    return Promise.all(results.map(async (session) => {
      const transcript = truncateTranscriptAroundSnippets(
        await this.loadTranscript(session.sessionId),
        session.snippets,
      );
      const summary = await this.options.summarizeSession?.({
        query,
        sessionId: session.sessionId,
        snippets: session.snippets,
        transcript,
      }).catch(() => null);

      return summary ? { ...session, summary } : session;
    }));
  }
}
