import { describe, expect, it } from 'vitest';
import { computeArtifactContentHash, serializeCanonicalJson } from '../hash.js';
import type { BuildroomArtifact } from '../model.js';

describe('Auto-Buildroom artifact hashing', () => {
  it('serializes objects with stable key ordering', () => {
    const left = { b: 2, a: { d: 4, c: 3 } };
    const right = { a: { c: 3, d: 4 }, b: 2 };

    expect(serializeCanonicalJson(left)).toBe(serializeCanonicalJson(right));
  });

  it('computes content hash excluding contentHash itself', () => {
    const artifact: BuildroomArtifact = {
      id: 'research_20260512_docs',
      type: 'research_packet',
      schemaVersion: 'auto-buildroom/v1',
      status: 'completed',
      createdAt: '2026-05-12T00:00:00.000Z',
      producer: { role: 'research', runId: 'run_research_1' },
      room: { id: 'anthroclaw-core' },
      parentIds: [],
      inputRefs: [],
      outputRefs: [],
      runtimeRefs: [],
      traceId: 'trace_docs',
      redaction: {
        rawTranscriptsIncluded: false,
        secretsRedacted: true,
        redactedFields: [],
      },
      contentHash: 'sha256:old-value',
      payload: { title: 'Docs research', count: 1 },
    };

    const first = computeArtifactContentHash(artifact);
    const second = computeArtifactContentHash({ ...artifact, contentHash: 'sha256:different' });

    expect(first).toBe(second);
    expect(first).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
});
