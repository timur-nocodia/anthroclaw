export type LearningMode = 'off' | 'propose' | 'auto_private';

export type LearningReviewStatus = 'running' | 'completed' | 'failed';

export type LearningReviewTrigger =
  | 'turn_interval'
  | 'user_correction'
  | 'tool_error_recovered'
  | 'tool_call_threshold'
  | 'skill_or_memory_activity'
  | 'compression_or_lcm'
  | 'manual'
  | (string & {});

export type LearningActionType =
  | 'memory_candidate'
  | 'skill_patch'
  | 'skill_create'
  | 'skill_update_full'
  | 'none';

export type LearningActionStatus =
  | 'proposed'
  | 'approved'
  | 'rejected'
  | 'applied'
  | 'failed';

export type LearningArtifactKind =
  | 'manifest'
  | 'file'
  | 'snippet'
  | 'transcript'
  | 'diagnostic'
  | (string & {});

export interface CreateLearningReviewParams {
  id?: string;
  agentId: string;
  sessionKey?: string;
  runId?: string;
  traceId?: string;
  sdkSessionId?: string;
  trigger: LearningReviewTrigger;
  mode: LearningMode;
  model?: string;
  startedAt?: number;
  input?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface LearningReviewRecord extends Required<Pick<CreateLearningReviewParams, 'agentId' | 'trigger' | 'mode'>> {
  id: string;
  sessionKey?: string;
  runId?: string;
  traceId?: string;
  sdkSessionId?: string;
  status: LearningReviewStatus;
  model?: string;
  startedAt: number;
  completedAt?: number;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  error?: string;
  metadata: Record<string, unknown>;
}

export interface CreateLearningActionParams {
  id?: string;
  reviewId: string;
  agentId: string;
  actionType: LearningActionType;
  status?: LearningActionStatus;
  confidence?: number;
  title?: string;
  rationale?: string;
  payload?: Record<string, unknown>;
  createdAt?: number;
}

export interface LearningActionRecord extends Required<Pick<CreateLearningActionParams, 'reviewId' | 'agentId' | 'actionType'>> {
  id: string;
  status: LearningActionStatus;
  confidence?: number;
  title: string;
  rationale: string;
  payload: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  appliedAt?: number;
  error?: string;
}

export interface CreateLearningArtifactParams {
  id?: string;
  reviewId: string;
  agentId: string;
  runId?: string;
  kind: LearningArtifactKind;
  path: string;
  contentHash: string;
  sizeBytes: number;
  reason?: string;
  metadata?: Record<string, unknown>;
  createdAt?: number;
}

export interface LearningArtifactRecord extends Required<Pick<CreateLearningArtifactParams, 'reviewId' | 'agentId' | 'kind' | 'path' | 'contentHash' | 'sizeBytes'>> {
  id: string;
  runId?: string;
  reason?: string;
  metadata: Record<string, unknown>;
  createdAt: number;
}

export interface CreateSkillSnapshotParams {
  id?: string;
  actionId?: string;
  agentId: string;
  skillName: string;
  path: string;
  contentHash: string;
  body: string;
  reason?: string;
  metadata?: Record<string, unknown>;
  createdAt?: number;
}

export interface SkillSnapshotRecord extends Required<Pick<CreateSkillSnapshotParams, 'agentId' | 'skillName' | 'path' | 'contentHash' | 'body'>> {
  id: string;
  actionId?: string;
  reason?: string;
  metadata: Record<string, unknown>;
  createdAt: number;
}
