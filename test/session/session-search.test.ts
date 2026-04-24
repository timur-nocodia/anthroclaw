import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { FileSessionStore } from '../../src/sdk/session-store.js';
import { TranscriptIndex } from '../../src/session/transcript-index.js';
import { SessionSearchService } from '../../src/session/session-search.js';

describe('SessionSearchService', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('indexes sdk session transcripts and returns grouped recall', async () => {
    const root = mkdtempSync(join(tmpdir(), 'session-search-'));
    tempDirs.push(root);
    mkdirSync(join(root, 'sdk'), { recursive: true });

    const projectKey = '/tmp/project-a';
    const store = new FileSessionStore(join(root, 'sdk'));
    await store.append({ projectKey, sessionId: 's-1' }, [
      {
        type: 'user',
        uuid: 'u1',
        timestamp: '2026-04-23T00:00:00.000Z',
        message: { content: [{ type: 'text', text: 'We discussed Claude Agent SDK hooks and permissions.' }] },
      },
      {
        type: 'assistant',
        uuid: 'a1',
        timestamp: '2026-04-23T00:00:01.000Z',
        message: { content: [{ type: 'text', text: 'The hook bridge uses PreToolUse and PermissionRequest.' }] },
      },
    ]);

    const service = new SessionSearchService({
      projectKey,
      sessionStore: store,
      transcriptIndex: new TranscriptIndex(join(root, 'transcripts.sqlite')),
    });

    const results = await service.search('hook bridge permissions');
    expect(results).toHaveLength(1);
    expect(results[0].sessionId).toBe('s-1');
    expect(results[0].snippets.some((snippet) => snippet.text.includes('hook bridge'))).toBe(true);
  });

  it('adds focused summaries when a summarizer is configured', async () => {
    const root = mkdtempSync(join(tmpdir(), 'session-search-summary-'));
    tempDirs.push(root);
    mkdirSync(join(root, 'sdk'), { recursive: true });

    const projectKey = '/tmp/project-summary';
    const store = new FileSessionStore(join(root, 'sdk'));
    await store.append({ projectKey, sessionId: 's-1' }, [
      {
        type: 'user',
        uuid: 'u1',
        timestamp: '2026-04-23T00:00:00.000Z',
        message: { content: [{ type: 'text', text: 'We decided to keep all LLM calls inside Claude Agent SDK query().' }] },
      },
      {
        type: 'assistant',
        uuid: 'a1',
        timestamp: '2026-04-23T00:00:01.000Z',
        message: { content: [{ type: 'text', text: 'The strict-native policy allows MCP tools and SDK hooks.' }] },
      },
    ]);

    const service = new SessionSearchService({
      projectKey,
      sessionStore: store,
      transcriptIndex: new TranscriptIndex(join(root, 'transcripts.sqlite')),
      summarizeSession: async (request) => {
        expect(request.query).toBe('strict native sdk');
        expect(request.sessionId).toBe('s-1');
        expect(request.transcript.length).toBeGreaterThan(0);
        return 'Strict-native policy was confirmed for SDK query(), MCP tools, and hooks.';
      },
    });

    const results = await service.searchWithSummaries('strict native sdk');
    expect(results).toHaveLength(1);
    expect(results[0].summary).toContain('Strict-native policy');
  });
});
