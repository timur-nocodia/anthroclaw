import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileArtifactStore } from '../../../auto-buildroom/artifacts/store.js';
import { createSessionSummaryArtifact } from '../../../auto-buildroom/sessions/session-summary.js';
import { initializeBuildroomStorage } from '../../../auto-buildroom/storage/init.js';
import {
  bindBuildroomHandoffToolForDispatch,
  bindBuildroomHandoffToolsForDispatch,
  createBuildroomHandoffTool,
} from '../buildroom-handoff.js';

describe('buildroom handoff tool', () => {
  let root: string;
  let store: FileArtifactStore;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'anthroclaw-buildroom-handoff-tool-'));
    initializeBuildroomStorage({ projectRoot: root, roomId: 'anthroclaw-core' });
    store = new FileArtifactStore({ projectRoot: root, roomId: 'anthroclaw-core' });
    store.writeArtifact(createSessionSummaryArtifact({
      roomId: 'anthroclaw-core',
      sourceAgentId: 'code-helper',
      sourceSessionId: 'session_xxx',
      now: '2026-05-12T00:00:00.000Z',
      summary: {
        userIntent: 'Improve operator summary.',
        observedFriction: ['Routing unclear.'],
        candidateSignals: [],
        evidenceRefs: [],
      },
    }));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('fails closed when Buildroom storage has not been initialized', async () => {
    const uninitializedRoot = mkdtempSync(join(tmpdir(), 'anthroclaw-buildroom-handoff-uninit-'));
    const tool = createBuildroomHandoffTool({
      projectRoot: uninitializedRoot,
      roomId: 'anthroclaw-core',
      sourceAgentId: 'code-helper',
      sourceSessionId: 'session_xxx',
      now: () => '2026-05-12T00:01:00.000Z',
    }) as unknown as {
      handler(args: Record<string, unknown>): Promise<{ content: Array<{ text: string }>; isError?: boolean }>;
    };

    try {
      const result = await tool.handler({
        signal_type: 'friction',
        summary: 'Notification routing needs clearer operator view.',
        evidence_summary_id: 'session-summary-20260512-000000-code-helper',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Buildroom handoff failed');
      expect(result.content[0].text).toContain('buildroom.yml');
    } finally {
      rmSync(uninitializedRoot, { recursive: true, force: true });
    }
  });

  it('creates a structured Buildroom handoff signal without authority', async () => {
    const tool = createBuildroomHandoffTool({
      projectRoot: root,
      roomId: 'anthroclaw-core',
      sourceAgentId: 'code-helper',
      sourceSessionId: 'session_xxx',
      now: () => '2026-05-12T00:01:00.000Z',
    }) as unknown as {
      handler(args: Record<string, unknown>): Promise<{ content: Array<{ text: string }>; isError?: boolean }>;
    };

    const result = await tool.handler({
      signal_type: 'friction',
      summary: 'Notification routing needs clearer operator view.',
      evidence_summary_id: 'session-summary-20260512-000000-code-helper',
      confidence: 'medium',
      requested_action: 'research_only',
    });

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('Buildroom handoff submitted: handoff_20260512_000100_code-helper_friction');
    const artifact = store.readArtifact('handoff_20260512_000100_code-helper_friction');
    expect(artifact).toMatchObject({
      type: 'handoff_signal',
      status: 'submitted',
      parentIds: ['session-summary-20260512-000000-code-helper'],
      payload: {
        authority: {
          canApprove: false,
          canBuild: false,
        },
      },
    });
  });

  it('requires a source session id when not bound by dispatch context', async () => {
    const tool = createBuildroomHandoffTool({
      projectRoot: root,
      roomId: 'anthroclaw-core',
      sourceAgentId: 'code-helper',
    }) as unknown as {
      handler(args: Record<string, unknown>): Promise<{ content: Array<{ text: string }>; isError?: boolean }>;
    };

    const result = await tool.handler({
      signal_type: 'friction',
      summary: 'Notification routing needs clearer operator view.',
      evidence_summary_id: 'session-summary-20260512-000000-code-helper',
      confidence: 'medium',
      requested_action: 'research_only',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('source_session_id is required');
  });

  it('accepts an explicit source_session_id when the tool is not dispatch-bound', async () => {
    const tool = createBuildroomHandoffTool({
      projectRoot: root,
      roomId: 'anthroclaw-core',
      sourceAgentId: 'code-helper',
      now: () => '2026-05-12T00:02:00.000Z',
    }) as unknown as {
      handler(args: Record<string, unknown>): Promise<{ content: Array<{ text: string }>; isError?: boolean }>;
    };

    const result = await tool.handler({
      signal_type: 'friction',
      summary: 'Notification routing needs clearer operator view.',
      evidence_summary_id: 'session-summary-20260512-000000-code-helper',
      source_session_id: 'session_from_dispatch',
      confidence: 'medium',
      requested_action: 'research_only',
    });

    expect(result.isError).toBeFalsy();
    const artifact = store.readArtifact('handoff_20260512_000200_code-helper_friction');
    expect(artifact.payload.sourceSessionId).toBe('session_from_dispatch');
  });

  it('rebinds the handoff tool with dispatch session context', async () => {
    const unbound = createBuildroomHandoffTool({
      projectRoot: root,
      roomId: 'anthroclaw-core',
      sourceAgentId: 'code-helper',
      now: () => '2026-05-12T00:03:00.000Z',
    });
    const rebound = bindBuildroomHandoffToolForDispatch(unbound, {
      projectRoot: root,
      roomId: 'anthroclaw-core',
      sourceAgentId: 'code-helper',
      sourceSessionId: 'agent:telegram:group:-1003931616911',
      now: () => '2026-05-12T00:03:00.000Z',
    }) as unknown as {
      handler(args: Record<string, unknown>): Promise<{ content: Array<{ text: string }>; isError?: boolean }>;
    };

    const result = await rebound.handler({
      signal_type: 'friction',
      summary: 'Notification routing needs clearer operator view.',
      evidence_summary_id: 'session-summary-20260512-000000-code-helper',
      confidence: 'medium',
      requested_action: 'research_only',
    });

    expect(result.isError).toBeFalsy();
    const artifact = store.readArtifact('handoff_20260512_000300_code-helper_friction');
    expect(artifact.payload.sourceSessionId).toBe('agent:telegram:group:-1003931616911');
  });

  it('rebinds only handoff tools in a dispatch tool list', async () => {
    const otherTool = {
      name: 'memory_search',
      description: 'other',
      inputSchema: {},
      handler: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
    };
    const unbound = createBuildroomHandoffTool({
      projectRoot: root,
      roomId: 'anthroclaw-core',
      sourceAgentId: 'code-helper',
      now: () => '2026-05-12T00:04:00.000Z',
    });

    const rebound = bindBuildroomHandoffToolsForDispatch([otherTool, unbound], {
      projectRoot: root,
      roomId: 'anthroclaw-core',
      sourceAgentId: 'code-helper',
      sourceSessionId: 'session_bound_from_gateway',
      now: () => '2026-05-12T00:04:00.000Z',
    });

    expect(rebound[0]).toBe(otherTool);
    expect(rebound[1]).not.toBe(unbound);
    const result = await (rebound[1] as unknown as {
      handler(args: Record<string, unknown>): Promise<{ isError?: boolean }>;
    }).handler({
      signal_type: 'friction',
      summary: 'Notification routing needs clearer operator view.',
      evidence_summary_id: 'session-summary-20260512-000000-code-helper',
    });

    expect(result.isError).toBeFalsy();
    expect(store.readArtifact('handoff_20260512_000400_code-helper_friction').payload.sourceSessionId)
      .toBe('session_bound_from_gateway');
  });
});
