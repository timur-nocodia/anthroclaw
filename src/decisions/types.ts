export type DecisionChannel = 'telegram' | 'whatsapp' | (string & {});

export type DecisionKind =
  | 'learning_memory'
  | 'learning_skill'
  | 'curator_action'
  | 'tool_approval';

export type DecisionScope = 'user' | 'agent' | 'system';
export type DecisionActor = 'originating_user' | 'admin' | 'operator';

export type DecisionStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'edit_requested'
  | 'expired'
  | 'applied'
  | 'failed';

export type DecisionRisk = 'low' | 'medium' | 'high';
export type DecisionSelection = 'approve' | 'reject' | 'edit' | 'undo';

export interface DecisionDeliveryRecord {
  id?: string;
  decisionId?: string;
  channel: DecisionChannel;
  accountId?: string;
  peerId?: string;
  messageId?: string;
  status: 'queued' | 'sent' | 'failed';
  error?: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface DecisionRecord {
  id: string;
  shortCode: string;
  kind: DecisionKind;
  scope: DecisionScope;
  actor: DecisionActor;
  status: DecisionStatus;
  agentId: string;
  learningActionId?: string;
  reviewId?: string;
  subject: string;
  body: string;
  risk: DecisionRisk;
  payload: Record<string, unknown>;
  originChannel?: DecisionChannel;
  originAccountId?: string;
  originPeerId?: string;
  originSenderId?: string;
  originThreadId?: string;
  originMessageId?: string;
  delivery: DecisionDeliveryRecord[];
  expiresAt?: number;
  createdAt: number;
  updatedAt: number;
  decidedAt?: number;
  decidedBy?: string;
  appliedAt?: number;
  error?: string;
}

export interface CreateDecisionParams {
  id?: string;
  shortCode?: string;
  kind: DecisionKind;
  scope: DecisionScope;
  actor: DecisionActor;
  status?: DecisionStatus;
  agentId: string;
  learningActionId?: string;
  reviewId?: string;
  subject: string;
  body: string;
  risk: DecisionRisk;
  payload?: Record<string, unknown>;
  originChannel?: DecisionChannel;
  originAccountId?: string;
  originPeerId?: string;
  originSenderId?: string;
  originThreadId?: string;
  originMessageId?: string;
  delivery?: DecisionDeliveryRecord[];
  expiresAt?: number;
  createdAt?: number;
}

export interface DecisionAuditEvent {
  id: string;
  decisionId: string;
  fromStatus?: DecisionStatus;
  toStatus: DecisionStatus;
  actorSenderId?: string;
  channel?: DecisionChannel;
  reason?: string;
  createdAt: number;
  metadata: Record<string, unknown>;
}

export interface DecisionEvent {
  decisionId?: string;
  shortCode?: string;
  selected: DecisionSelection;
  channel: DecisionChannel;
  accountId: string;
  peerId: string;
  senderId: string;
  threadId?: string;
  messageId?: string;
  rawText?: string;
  callbackQueryId?: string;
}

export interface DecisionResolution {
  handled: boolean;
  status?: DecisionStatus;
  reason?: string;
  decision?: DecisionRecord;
}
