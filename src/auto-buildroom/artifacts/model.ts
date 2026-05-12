export type BuildroomArtifactType =
  | 'session_summary'
  | 'handoff_signal'
  | 'research_packet'
  | 'signal'
  | 'idea_contract'
  | 'main_review'
  | 'approval'
  | 'build_plan'
  | 'coder_receipt'
  | 'qa_report'
  | 'verification_delta'
  | 'trust_report'
  | 'operator_summary'
  | 'operator_decision'
  | 'error_receipt'
  | 'retention_review';

export interface BuildroomArtifactRef {
  kind: 'artifact' | 'file' | 'runtime' | 'session-summary';
  ref: string;
  hash?: string;
}

export interface BuildroomRuntimeRef {
  runtime: string;
  runId?: string;
  sessionId?: string;
  eventRef?: string;
}

export interface BuildroomArtifact {
  id: string;
  type: BuildroomArtifactType;
  schemaVersion: 'auto-buildroom/v1';
  status: string;
  createdAt: string;
  producer: {
    role: string;
    runId: string;
  };
  room: {
    id: string;
  };
  parentIds: string[];
  inputRefs: BuildroomArtifactRef[];
  outputRefs: BuildroomArtifactRef[];
  runtimeRefs: BuildroomRuntimeRef[];
  traceId: string;
  redaction: {
    rawTranscriptsIncluded: boolean;
    secretsRedacted: boolean;
    redactedFields: string[];
  };
  contentHash: string;
  supersedesId?: string | null;
  payload: Record<string, unknown>;
}
