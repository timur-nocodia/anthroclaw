import { describe, expect, it } from 'vitest';
import { createHandoffSignalArtifact } from '../handoff-signal.js';

describe('Buildroom handoff signal artifacts', () => {
  it('creates a structured ordinary-agent handoff with no build or approval authority', () => {
    const artifact = createHandoffSignalArtifact({
      roomId: 'anthroclaw-core',
      sourceAgentId: 'code-helper',
      sourceSessionId: 'session_xxx',
      targetBuildroom: 'anthroclaw-core',
      signalType: 'friction',
      summary: 'Notification routing needs clearer operator view.',
      evidenceRefs: [{ kind: 'artifact', ref: 'session-summary-20260512-000000-code-helper' }],
      confidence: 'medium',
      requestedAction: 'research_only',
      now: '2026-05-12T00:00:00.000Z',
    });

    expect(artifact).toMatchObject({
      id: 'handoff_20260512_000000_code-helper_friction',
      type: 'handoff_signal',
      status: 'submitted',
      parentIds: ['session-summary-20260512-000000-code-helper'],
      payload: {
        sourceAgentId: 'code-helper',
        sourceSessionId: 'session_xxx',
        targetBuildroom: 'anthroclaw-core',
        signalType: 'friction',
        requestedAction: 'research_only',
        authority: {
          canApprove: false,
          canBuild: false,
        },
      },
    });
  });
});
