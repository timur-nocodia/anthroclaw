import { describe, expect, it } from 'vitest';
import { formatBuildroomLifecycleNotification } from '../lifecycle.js';
import type { BuildroomArtifact } from '../../artifacts/model.js';

describe('Buildroom lifecycle notifications', () => {
  it('renders Builder completion without authority semantics', () => {
    expect(formatBuildroomLifecycleNotification(artifact('build_20260512_docs', 'coder_receipt', {
      runtimeStatus: 'completed',
    }))).toBe([
      'Buildroom: builder completed',
      'Receipt: build_20260512_docs',
      'Next: /buildroom qa build_20260512_docs',
      '',
      'Notification only. Approval still requires explicit /buildroom commands.',
    ].join('\n'));
  });

  it('renders Trust state near the top', () => {
    expect(formatBuildroomLifecycleNotification(artifact('trust_20260512_docs', 'trust_report', {
      trustState: 'watch',
      reasons: ['missing claim evidence'],
    }))).toBe([
      'Buildroom trust: WATCH',
      'Receipt: trust_20260512_docs',
      'Reason: missing claim evidence',
      'Next: /buildroom report',
      '',
      'Notification only. Approval still requires explicit /buildroom commands.',
    ].join('\n'));
  });

  it('redacts secret-like values from rendered notification fields', () => {
    const text = formatBuildroomLifecycleNotification(artifact('trust_20260512_docs', 'trust_report', {
      trustState: 'blocked',
      reasons: ['runtime leaked token sk-ant-123456789012345678901234567890'],
    }));

    expect(text).toContain('sk-ant****7890');
    expect(text).not.toContain('sk-ant-123456789012345678901234567890');
  });

  it('does not render unsupported artifacts', () => {
    expect(formatBuildroomLifecycleNotification(artifact('idea_20260512_docs', 'idea_contract', {})))
      .toBeNull();
  });

  function artifact(
    id: string,
    type: BuildroomArtifact['type'],
    payload: Record<string, unknown>,
  ): BuildroomArtifact {
    return {
      id,
      type,
      schemaVersion: 'auto-buildroom/v1',
      status: 'completed',
      createdAt: '2026-05-12T00:00:00.000Z',
      producer: { role: 'test', runId: `run_${id}` },
      room: { id: 'anthroclaw-core' },
      parentIds: [],
      inputRefs: [],
      outputRefs: [],
      runtimeRefs: [],
      traceId: `trace_${id}`,
      redaction: {
        rawTranscriptsIncluded: false,
        secretsRedacted: true,
        redactedFields: [],
      },
      contentHash: '',
      payload,
    };
  }
});
