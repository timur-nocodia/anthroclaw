import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileArtifactStore } from '../../../auto-buildroom/artifacts/store.js';
import { initializeBuildroomStorage } from '../../../auto-buildroom/storage/init.js';
import {
  bindBuildroomSessionSummaryToolsForDispatch,
  createBuildroomSessionSummaryTool,
} from '../buildroom-session-summary.js';

describe('buildroom session summary tool', () => {
  let root: string;
  let store: FileArtifactStore;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'anthroclaw-buildroom-session-summary-tool-'));
    initializeBuildroomStorage({ projectRoot: root, roomId: 'anthroclaw-core' });
    store = new FileArtifactStore({ projectRoot: root, roomId: 'anthroclaw-core' });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('creates a sanitized session summary with no approval authority', async () => {
    const tool = createBuildroomSessionSummaryTool({
      projectRoot: root,
      roomId: 'anthroclaw-core',
      sourceAgentId: 'code-helper',
      sourceSessionId: 'session_xxx',
      now: () => '2026-05-12T00:00:00.000Z',
    }) as unknown as {
      handler(args: Record<string, unknown>): Promise<{ content: Array<{ text: string }>; isError?: boolean }>;
    };

    const result = await tool.handler({
      user_intent: 'User asked about improving operator summary.',
      observed_friction: ['Operator could not tell which outputs were routed where.'],
      candidate_signals: [{
        type: 'friction',
        text: 'Notification routing needs clearer operator view.',
        confidence: 'medium',
      }],
      evidence_excerpt: 'Sanitized short excerpt, not full transcript.',
    });

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('Buildroom session summary submitted: session-summary-20260512-000000-code-helper');
    const artifact = store.readArtifact('session-summary-20260512-000000-code-helper');
    expect(artifact).toMatchObject({
      type: 'session_summary',
      status: 'sanitized',
      redaction: {
        rawTranscriptsIncluded: false,
        secretsRedacted: true,
      },
      payload: {
        sourceAgentId: 'code-helper',
        sourceSessionId: 'session_xxx',
        allowedUse: {
          canApproveWork: false,
        },
        privacy: {
          rawTranscriptIncluded: false,
        },
      },
    });
  });

  it('requires source_session_id when not dispatch-bound', async () => {
    const tool = createBuildroomSessionSummaryTool({
      projectRoot: root,
      roomId: 'anthroclaw-core',
      sourceAgentId: 'code-helper',
    }) as unknown as {
      handler(args: Record<string, unknown>): Promise<{ content: Array<{ text: string }>; isError?: boolean }>;
    };

    const result = await tool.handler({
      user_intent: 'User asked about improving operator summary.',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('source_session_id is required');
  });

  it('rebinds only session summary tools in a dispatch tool list', async () => {
    const otherTool = {
      name: 'memory_search',
      description: 'other',
      inputSchema: {},
      handler: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
    };
    const unbound = createBuildroomSessionSummaryTool({
      projectRoot: root,
      roomId: 'anthroclaw-core',
      sourceAgentId: 'code-helper',
      now: () => '2026-05-12T00:01:00.000Z',
    });

    const rebound = bindBuildroomSessionSummaryToolsForDispatch([otherTool, unbound], {
      projectRoot: root,
      roomId: 'anthroclaw-core',
      sourceAgentId: 'code-helper',
      sourceSessionId: 'session_bound_from_gateway',
      now: () => '2026-05-12T00:01:00.000Z',
    });

    expect(rebound[0]).toBe(otherTool);
    expect(rebound[1]).not.toBe(unbound);
    const result = await (rebound[1] as unknown as {
      handler(args: Record<string, unknown>): Promise<{ isError?: boolean }>;
    }).handler({
      user_intent: 'User asked about improving operator summary.',
    });

    expect(result.isError).toBeFalsy();
    expect(store.readArtifact('session-summary-20260512-000100-code-helper').payload.sourceSessionId)
      .toBe('session_bound_from_gateway');
  });
});
