import { describe, expect, it } from 'vitest';
import type { BuildroomArtifact } from '../../artifacts/model.js';
import {
  createQaReportArtifact,
  createTrustReportArtifact,
  createVerificationDeltaArtifact,
} from '../trust.js';

describe('Auto-Buildroom QA, Delta, and Trust', () => {
  it('classifies every Builder claim and can produce clean trust when evidence confirms claims', () => {
    const build = coderReceipt({
      builderClaims: ['Updated operator guide.'],
      postRunPolicyResult: { allowed: true, changedFiles: ['docs/guide.md'], violations: [] },
    });
    const qa = createQaReportArtifact({
      build,
      now: '2026-05-12T00:20:00.000Z',
      evidence: [{ claim: 'Updated operator guide.', status: 'confirmed' }],
    });
    const delta = createVerificationDeltaArtifact({
      build,
      qa,
      now: '2026-05-12T00:21:00.000Z',
    });
    const trust = createTrustReportArtifact({
      build,
      qa,
      delta,
      now: '2026-05-12T00:22:00.000Z',
    });

    expect(delta.payload.claimComparisons).toEqual([
      {
        claim: 'Updated operator guide.',
        status: 'confirmed',
        criticality: 'medium',
      },
    ]);
    expect(trust).toMatchObject({
      type: 'trust_report',
      status: 'clean',
      parentIds: [delta.id, qa.id, build.id],
      payload: {
        trustState: 'clean',
      },
    });
  });

  it('marks missing claim evidence as investigate', () => {
    const build = coderReceipt({
      builderClaims: ['Updated operator guide.', 'Added regression test.'],
      postRunPolicyResult: { allowed: true, changedFiles: ['docs/guide.md'], violations: [] },
    });
    const qa = createQaReportArtifact({
      build,
      now: '2026-05-12T00:20:00.000Z',
      evidence: [{ claim: 'Updated operator guide.', status: 'confirmed' }],
    });
    const delta = createVerificationDeltaArtifact({
      build,
      qa,
      now: '2026-05-12T00:21:00.000Z',
    });
    const trust = createTrustReportArtifact({
      build,
      qa,
      delta,
      now: '2026-05-12T00:22:00.000Z',
    });

    expect(delta.payload.claimComparisons).toContainEqual({
      claim: 'Added regression test.',
      status: 'missing_evidence',
      criticality: 'medium',
    });
    expect(trust.status).toBe('investigate');
    expect(trust.payload.trustState).toBe('investigate');
  });

  it('blocks trust when post-run policy has violations', () => {
    const build = coderReceipt({
      builderClaims: ['Updated operator guide.'],
      postRunPolicyResult: {
        allowed: false,
        changedFiles: ['agents/example/AGENTS.md'],
        violations: [{ path: 'agents/example/AGENTS.md', reason: 'blocked_path' }],
      },
    });
    const qa = createQaReportArtifact({
      build,
      now: '2026-05-12T00:20:00.000Z',
      evidence: [{ claim: 'Updated operator guide.', status: 'confirmed' }],
    });
    const delta = createVerificationDeltaArtifact({
      build,
      qa,
      now: '2026-05-12T00:21:00.000Z',
    });
    const trust = createTrustReportArtifact({
      build,
      qa,
      delta,
      now: '2026-05-12T00:22:00.000Z',
    });

    expect(trust.status).toBe('blocked');
    expect(trust.payload.trustState).toBe('blocked');
    expect(trust.payload.reasons).toContain('post-run policy violation');
  });

  function coderReceipt(payload: Record<string, unknown>): BuildroomArtifact {
    return {
      id: 'build_20260512_docs',
      type: 'coder_receipt',
      schemaVersion: 'auto-buildroom/v1',
      status: 'submitted',
      createdAt: '2026-05-12T00:10:00.000Z',
      producer: { role: 'builder', runId: 'builder:plan_20260512_docs' },
      room: { id: 'anthroclaw-core' },
      parentIds: ['plan_20260512_docs', 'approval_20260512_docs'],
      inputRefs: [],
      outputRefs: [],
      runtimeRefs: [{ runtime: 'native-agent-sdk', sessionId: 'session_builder_1' }],
      traceId: 'trace_20260512_docs',
      redaction: {
        rawTranscriptsIncluded: false,
        secretsRedacted: true,
        redactedFields: [],
      },
      contentHash: '',
      payload: {
        runtimeStatus: 'completed',
        ...payload,
      },
    };
  }
});

