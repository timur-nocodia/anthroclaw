import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileArtifactStore } from '../../../auto-buildroom/artifacts/store.js';
import { createSessionSummaryArtifact } from '../../../auto-buildroom/sessions/session-summary.js';
import { initializeBuildroomStorage } from '../../../auto-buildroom/storage/init.js';
import { createBuildroomHandoffTool } from '../buildroom-handoff.js';

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
});
