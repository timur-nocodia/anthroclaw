import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { FileSessionStore } from '../../../src/sdk/session-store.js';
import { TranscriptIndex } from '../../../src/session/transcript-index.js';
import { SessionSearchService } from '../../../src/session/session-search.js';
import { createSessionSearchTool } from '../../../src/agent/tools/session-search.js';

describe('createSessionSearchTool', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns compact recalled prior session context', async () => {
    const root = mkdtempSync(join(tmpdir(), 'session-search-tool-'));
    tempDirs.push(root);
    const projectKey = '/tmp/project-b';
    const store = new FileSessionStore(join(root, 'sdk'));
    mkdirSync(join(root, 'sdk'), { recursive: true });

    await store.append({ projectKey, sessionId: 'sess-1' }, [
      {
        type: 'user',
        uuid: 'u1',
        timestamp: '2026-04-23T00:00:00.000Z',
        message: { text: 'We talked about session recall last week.' },
      },
      {
        type: 'assistant',
        uuid: 'a1',
        timestamp: '2026-04-23T00:00:01.000Z',
        message: { text: 'A transcript index would support session_search.' },
      },
    ]);

    const tool = createSessionSearchTool(new SessionSearchService({
      projectKey,
      sessionStore: store,
      transcriptIndex: new TranscriptIndex(join(root, 'transcripts.sqlite')),
    }));

    const result = await tool.handler({ query: 'transcript index recall' });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('<memory-context>');
    expect(result.content[0].text).toContain('session_search');
  });

  it('includes focused summaries when available', async () => {
    const root = mkdtempSync(join(tmpdir(), 'session-search-tool-summary-'));
    tempDirs.push(root);
    const projectKey = '/tmp/project-c';
    const store = new FileSessionStore(join(root, 'sdk'));
    mkdirSync(join(root, 'sdk'), { recursive: true });

    await store.append({ projectKey, sessionId: 'sess-1' }, [
      {
        type: 'user',
        uuid: 'u1',
        timestamp: '2026-04-23T00:00:00.000Z',
        message: { text: 'The session_search tool should summarize matching transcripts.' },
      },
    ]);

    const tool = createSessionSearchTool(new SessionSearchService({
      projectKey,
      sessionStore: store,
      transcriptIndex: new TranscriptIndex(join(root, 'transcripts.sqlite')),
      summarizeSession: async () => 'The prior session covered transcript-backed recall summaries.',
    }));

    const result = await tool.handler({ query: 'transcript summaries' });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Focused summary:');
    expect(result.content[0].text).toContain('transcript-backed recall summaries');
  });

  it('can skip summarization', async () => {
    const root = mkdtempSync(join(tmpdir(), 'session-search-tool-no-summary-'));
    tempDirs.push(root);
    const projectKey = '/tmp/project-d';
    const store = new FileSessionStore(join(root, 'sdk'));
    mkdirSync(join(root, 'sdk'), { recursive: true });

    await store.append({ projectKey, sessionId: 'sess-1' }, [
      {
        type: 'user',
        uuid: 'u1',
        timestamp: '2026-04-23T00:00:00.000Z',
        message: { text: 'Recall without summaries still returns snippets.' },
      },
    ]);

    const tool = createSessionSearchTool(new SessionSearchService({
      projectKey,
      sessionStore: store,
      transcriptIndex: new TranscriptIndex(join(root, 'transcripts.sqlite')),
      summarizeSession: async () => 'This should not appear.',
    }));

    const result = await tool.handler({ query: 'summaries snippets', summarize: false });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).not.toContain('This should not appear');
    expect(result.content[0].text).toContain('Recall without summaries');
  });
});
