import type { BuildroomArtifact, BuildroomArtifactRef } from '../artifacts/model.js';

export interface CreateHandoffSignalArtifactOptions {
  roomId: string;
  sourceAgentId: string;
  sourceSessionId: string;
  targetBuildroom: string;
  signalType: string;
  summary: string;
  evidenceRefs: BuildroomArtifactRef[];
  confidence: 'low' | 'medium' | 'high';
  requestedAction: 'research_only' | 'create_idea_candidate';
  now: string;
}

export function createHandoffSignalArtifact(
  opts: CreateHandoffSignalArtifactOptions,
): BuildroomArtifact {
  const digits = opts.now.replace(/[^0-9]/g, '').slice(0, 14);
  const date = digits.slice(0, 8);
  const time = digits.slice(8, 14);
  const sourceSlug = slugify(opts.sourceAgentId);
  const signalSlug = slugify(opts.signalType);
  return {
    id: `handoff_${date}_${time}_${sourceSlug}_${signalSlug}`,
    type: 'handoff_signal',
    schemaVersion: 'auto-buildroom/v1',
    status: 'submitted',
    createdAt: opts.now,
    producer: {
      role: 'ordinary_agent_handoff',
      runId: `run_${digits}_handoff`,
    },
    room: { id: opts.roomId },
    parentIds: opts.evidenceRefs
      .filter((ref) => ref.kind === 'artifact')
      .map((ref) => ref.ref),
    inputRefs: opts.evidenceRefs,
    outputRefs: [],
    runtimeRefs: [],
    traceId: `trace_handoff_${digits}_${sourceSlug}_${signalSlug}`,
    redaction: {
      rawTranscriptsIncluded: false,
      secretsRedacted: true,
      redactedFields: [],
    },
    contentHash: '',
    payload: {
      sourceAgentId: opts.sourceAgentId,
      sourceSessionId: opts.sourceSessionId,
      targetBuildroom: opts.targetBuildroom,
      signalType: opts.signalType,
      summary: opts.summary,
      evidenceRefs: opts.evidenceRefs,
      confidence: opts.confidence,
      requestedAction: opts.requestedAction,
      authority: {
        canApprove: false,
        canBuild: false,
      },
    },
  };
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'signal';
}
