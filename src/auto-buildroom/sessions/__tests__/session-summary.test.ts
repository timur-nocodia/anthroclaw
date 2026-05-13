import { describe, expect, it } from 'vitest';
import { createSessionSummaryArtifact } from '../session-summary.js';

describe('Buildroom session summary artifacts', () => {
  it('creates a sanitized ordinary-agent session summary with no approval authority', () => {
    const artifact = createSessionSummaryArtifact({
      roomId: 'anthroclaw-core',
      sourceAgentId: 'code-helper',
      sourceSessionId: 'session_xxx',
      now: '2026-05-12T00:00:00.000Z',
      summary: {
        userIntent: 'User asked about improving operator summary.',
        observedFriction: ['Operator could not tell which outputs were routed where.'],
        candidateSignals: [
          {
            type: 'friction',
            text: 'Notification routing needs clearer operator view.',
            confidence: 'medium',
          },
        ],
        evidenceRefs: [
          {
            type: 'session',
            ref: 'session_xxx',
            excerpt: 'Sanitized short excerpt, not full transcript.',
          },
        ],
      },
    });

    expect(artifact).toMatchObject({
      id: 'session-summary-20260512-000000-code-helper',
      type: 'session_summary',
      status: 'sanitized',
      redaction: {
        rawTranscriptsIncluded: false,
        secretsRedacted: true,
      },
      payload: {
        sourceAgentId: 'code-helper',
        sourceSessionId: 'session_xxx',
        privacy: {
          rawTranscriptIncluded: false,
          piiRedacted: true,
          secretsRedacted: true,
        },
        allowedUse: {
          canBeUsedForResearch: true,
          canCreateIdeaCandidate: true,
          canApproveWork: false,
        },
      },
    });
  });
});
