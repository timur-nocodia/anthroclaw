import type { BuildroomArtifact } from '../artifacts/model.js';
import type { BuildroomConfig } from '../config/model.js';

export function createDeterministicResearchPacket(
  config: BuildroomConfig,
  now: string,
): BuildroomArtifact {
  const suffix = timestampSuffix(now);
  return {
    id: `research_${suffix}_auto_buildroom_docs`,
    type: 'research_packet',
    schemaVersion: 'auto-buildroom/v1',
    status: 'completed',
    createdAt: now,
    producer: { role: 'research', runId: `deterministic:${suffix}` },
    room: { id: config.roomId },
    parentIds: [],
    inputRefs: [],
    outputRefs: [],
    runtimeRefs: [],
    traceId: `trace_${suffix}_auto_buildroom_docs`,
    redaction: {
      rawTranscriptsIncluded: false,
      secretsRedacted: true,
      redactedFields: [],
    },
    contentHash: '',
    payload: {
      topic: 'Auto-Buildroom local docs/test loop',
      facts: [
        'v0.1 Buildroom state is project-local.',
        'Buildroom approvals must target locked Main Review receipts.',
      ],
      interpretations: [
        'The first useful loop should improve docs/examples/tests without runtime mutation.',
      ],
      coverage: {
        partial: false,
        inspectedRefs: ['docs/Auto-Buildroom/**'],
        skippedRefs: [],
        budgetLimitsHit: [],
      },
      sourcePolicyResult: {
        allowed: true,
        scannedPaths: config.paths.allowed,
        skippedBlockedPaths: config.paths.blocked,
        violations: [],
      },
      researchHealth: {
        status: 'ok',
        warnings: [],
      },
    },
  };
}

export function createDeterministicIdeaContract(
  research: BuildroomArtifact,
  now: string,
): BuildroomArtifact {
  const suffix = suffixFromArtifact(research.id, 'research');
  return {
    id: `idea_${suffix}`,
    type: 'idea_contract',
    schemaVersion: 'auto-buildroom/v1',
    status: 'ready_for_review',
    createdAt: now,
    producer: { role: 'dreamer', runId: `deterministic:${suffix}` },
    room: research.room,
    parentIds: [research.id],
    inputRefs: [{ kind: 'artifact', ref: research.id }],
    outputRefs: [],
    runtimeRefs: [],
    traceId: research.traceId,
    redaction: research.redaction,
    contentHash: '',
    payload: {
      title: 'Improve Auto-Buildroom operator docs/examples',
      summary: 'Create a narrow docs/test proposal from the deterministic research packet.',
      requestedAction: 'review_only',
      authority: {
        canApprove: false,
        canBuild: false,
      },
    },
  };
}

export function createDeterministicMainReview(
  idea: BuildroomArtifact,
  config: BuildroomConfig,
  now: string,
): BuildroomArtifact {
  if (idea.type !== 'idea_contract') {
    throw new Error('Main Review requires an idea_contract artifact');
  }

  const suffix = suffixFromArtifact(idea.id, 'idea');
  return {
    id: `review_${suffix}`,
    type: 'main_review',
    schemaVersion: 'auto-buildroom/v1',
    status: 'completed',
    createdAt: now,
    producer: { role: 'main', runId: `deterministic:${suffix}` },
    room: idea.room,
    parentIds: [idea.id],
    inputRefs: [{ kind: 'artifact', ref: idea.id }],
    outputRefs: [],
    runtimeRefs: [],
    traceId: idea.traceId,
    redaction: idea.redaction,
    contentHash: '',
    payload: {
      decision: 'approved_for_operator',
      rationale: 'Narrow local docs/test work is eligible for explicit operator approval.',
      lockedScope: {
        allowedPaths: config.paths.allowed,
        blockedPaths: config.paths.blocked,
        nonGoals: ['deploy', 'external side effects', 'agent config changes'],
      },
      acceptanceCriteria: [
        'Receipt chain remains explicit.',
        'Operator can inspect proposal before approval.',
      ],
    },
  };
}

function timestampSuffix(isoTimestamp: string): string {
  return isoTimestamp.replaceAll(/[-:.TZ]/g, '').slice(0, 14);
}

function suffixFromArtifact(id: string, prefix: string): string {
  const expectedPrefix = `${prefix}_`;
  return id.startsWith(expectedPrefix) ? id.slice(expectedPrefix.length) : id;
}

