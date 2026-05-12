import type { BuildroomArtifact } from '../artifacts/model.js';

export interface SessionSummarySignal {
  type: string;
  text: string;
  confidence: 'low' | 'medium' | 'high';
}

export interface SessionSummaryEvidenceRef {
  type: string;
  ref: string;
  excerpt?: string;
}

export interface CreateSessionSummaryArtifactOptions {
  roomId: string;
  sourceAgentId: string;
  sourceSessionId: string;
  now: string;
  summary: {
    userIntent: string;
    observedFriction: string[];
    candidateSignals: SessionSummarySignal[];
    evidenceRefs: SessionSummaryEvidenceRef[];
  };
}

export function createSessionSummaryArtifact(
  opts: CreateSessionSummaryArtifactOptions,
): BuildroomArtifact {
  const digits = opts.now.replace(/[^0-9]/g, '').slice(0, 14);
  const timestamp = `${digits.slice(0, 8)}-${digits.slice(8, 14)}`;
  const runTimestamp = digits;
  const agentSlug = slugify(opts.sourceAgentId);
  return {
    id: `session-summary-${timestamp}-${agentSlug}`,
    type: 'session_summary',
    schemaVersion: 'auto-buildroom/v1',
    status: 'sanitized',
    createdAt: opts.now,
    producer: {
      role: 'summary_extractor',
      runId: `run_${runTimestamp}_session_summary`,
    },
    room: { id: opts.roomId },
    parentIds: [],
    inputRefs: [{ kind: 'session-summary', ref: opts.sourceSessionId }],
    outputRefs: [],
    runtimeRefs: [],
    traceId: `trace_session_summary_${timestamp}_${agentSlug}`,
    redaction: {
      rawTranscriptsIncluded: false,
      secretsRedacted: true,
      redactedFields: [],
    },
    contentHash: '',
    payload: {
      sourceAgentId: opts.sourceAgentId,
      sourceSessionId: opts.sourceSessionId,
      createdAt: opts.now,
      summary: opts.summary,
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
  };
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'agent';
}
