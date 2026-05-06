import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { getAgentConfig, setAgentLearningConfig, ValidationError } from '@/lib/agents';
import { getGateway } from '@/lib/gateway';
import { DecisionStore } from '@backend/decisions/store.js';
import { LearningStore } from '@backend/learning/store.js';
import { applyMemoryCandidateAction } from '@backend/learning/memory-applier.js';
import { applySkillAction } from '@backend/learning/skill-applier.js';
import { MemoryStore } from '@backend/memory/store.js';
import { metrics } from '@backend/metrics/collector.js';
import type { LearningActionRecord, LearningMode } from '@backend/learning/types.js';
import type { DecisionActor, DecisionKind, DecisionStatus } from '@backend/decisions/types.js';

const DATA_DIR = resolve(process.cwd(), '..', 'data');
const AGENTS_DIR = resolve(process.cwd(), '..', 'agents');

const ACTION_STATUSES = new Set(['proposed', 'approved', 'rejected', 'applied', 'failed']);
const ACTION_TYPES = new Set(['memory_candidate', 'skill_patch', 'skill_create', 'skill_update_full', 'none']);
const DECISION_STATUSES = new Set(['pending', 'approved', 'rejected', 'edit_requested', 'expired', 'applied', 'failed']);
const DECISION_KINDS = new Set(['learning_memory', 'learning_skill', 'curator_action', 'tool_approval']);
const DECISION_ACTORS = new Set(['originating_user', 'admin', 'operator']);

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  return withAuth(async () => {
    const { agentId } = await params;
    const url = new URL(req.url);
    const status = parseActionStatus(url.searchParams.get('status'));
    const actionType = parseActionType(url.searchParams.get('type'));
    const decisionStatus = parseDecisionStatus(url.searchParams.get('decisionStatus'));
    const decisionKind = parseDecisionKind(url.searchParams.get('decisionKind'));
    const decisionActor = parseDecisionActor(url.searchParams.get('decisionActor'));
    const limit = optionalNumber(url.searchParams.get('limit')) ?? 100;
    const offset = optionalNumber(url.searchParams.get('offset')) ?? 0;
    const config = getAgentConfig(agentId).parsed;
    const store = openLearningStore();
    const decisionStore = openDecisionStore();
    try {
      const actions = store.listActions({ agentId, status, actionType, limit, offset });
      const reviews = store.listReviews({ agentId, limit: 50 });
      const artifacts = store.listArtifacts({ limit: 1000 }).filter((artifact) => artifact.agentId === agentId);
      const snapshots = store.listSkillSnapshots({ agentId, limit: 1000 });
      const decisions = decisionStore.listDecisions({
        agentId,
        status: decisionStatus,
        kind: decisionKind,
        actor: decisionActor,
        limit: 200,
      }).map((decision) => ({
        ...decision,
        delivery: decisionStore.listDeliveries(decision.id),
        auditEvents: decisionStore.listAuditEvents(decision.id),
      }));
      const pendingDecisionAge = summarizePendingDecisionAge(decisions);
      return NextResponse.json({
        config: {
          safety_profile: config.safety_profile,
          learning: normalizeLearningConfig(config.learning),
        },
        summary: {
          pending: actions.filter((action) => action.status === 'proposed').length,
          lastReviewAt: reviews[0]?.completedAt ?? reviews[0]?.startedAt,
          lastFailure: reviews.find((review) => review.status === 'failed')?.error,
          reviewsByStatus: countBy(reviews.map((review) => review.status)),
          actionsByStatus: countBy(actions.map((action) => action.status)),
          actionsByType: countBy(actions.map((action) => action.actionType)),
          pendingDecisions: decisions.filter((decision) => decision.status === 'pending').length,
          pendingDecisionAge,
          decisionsByStatus: countBy(decisions.map((decision) => decision.status)),
          decisionsByKind: countBy(decisions.map((decision) => decision.kind)),
          artifactCount: artifacts.length,
          skillSnapshotCount: snapshots.length,
        },
        actions,
        decisions,
        reviews,
        artifacts: artifacts.slice(0, 100),
      });
    } finally {
      store.close();
      decisionStore.close();
    }
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  return withAuth(async () => {
    const { agentId } = await params;
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const operation = typeof body.operation === 'string' ? body.operation : '';

    if (operation === 'update_config') {
      const learning = normalizeLearningConfig(body.learning);
      setAgentLearningConfig(agentId, learning);
      return NextResponse.json({ ok: true, learning });
    }

    if (operation === 'resend_decision') {
      const decisionId = typeof body.decisionId === 'string' ? body.decisionId : '';
      if (!decisionId) {
        throw new ValidationError('bad_request', 'Expected decisionId');
      }
      const gateway = await getGateway();
      const resend = await gateway.resendDecisionPrompt(decisionId, agentId);
      const status = resend.reason === 'not_found'
        ? 404
        : resend.ok
          ? 200
          : 400;
      return NextResponse.json({ ok: resend.ok, resend }, { status });
    }

    if (
      operation === 'approve_decision'
      || operation === 'reject_decision'
      || operation === 'request_edit_decision'
      || operation === 'expire_decision'
      || operation === 'apply_decision'
    ) {
      const decisionId = typeof body.decisionId === 'string' ? body.decisionId : '';
      if (!decisionId) {
        throw new ValidationError('bad_request', 'Expected decisionId');
      }
      const store = openLearningStore();
      const decisionStore = openDecisionStore();
      try {
        const decision = decisionStore.getDecision(decisionId);
        if (!decision || decision.agentId !== agentId) {
          return NextResponse.json({ error: 'not_found' }, { status: 404 });
        }
        const action = decision.learningActionId ? store.getAction(decision.learningActionId) : null;
        if (decision.learningActionId && (!action || action.agentId !== agentId)) {
          return NextResponse.json({ error: 'not_found' }, { status: 404 });
        }

        if (operation === 'approve_decision') {
          const updated = decisionStore.updateDecisionStatus(decision.id, 'approved', {
            decidedBy: 'admin',
            actorSenderId: 'admin',
            channel: 'dashboard',
            reason: 'admin_approved',
          });
          if (!updated) {
            return invalidDecisionTransition(decision.id, decision.status, 'approved');
          }
          if (action && action.status === 'proposed') {
            store.updateActionStatus(action.id, 'approved', { updatedAt: Date.now() });
          }
          return NextResponse.json({ ok: true, decision: updated, action: action ? store.getAction(action.id) : null });
        }

        if (operation === 'reject_decision') {
          const reason = typeof body.reason === 'string' ? body.reason : undefined;
          const updated = decisionStore.updateDecisionStatus(decision.id, 'rejected', {
            decidedBy: 'admin',
            actorSenderId: 'admin',
            channel: 'dashboard',
            reason: 'admin_rejected',
            error: reason,
          });
          if (!updated) {
            return invalidDecisionTransition(decision.id, decision.status, 'rejected');
          }
          if (action && (action.status === 'proposed' || action.status === 'approved')) {
            store.updateActionStatus(action.id, 'rejected', { updatedAt: Date.now(), error: reason });
          }
          metrics.increment('learning_actions_rejected');
          return NextResponse.json({ ok: true, decision: updated, action: action ? store.getAction(action.id) : null });
        }

        if (operation === 'request_edit_decision') {
          const reason = typeof body.reason === 'string' ? body.reason : undefined;
          const updated = decisionStore.updateDecisionStatus(decision.id, 'edit_requested', {
            decidedBy: 'admin',
            actorSenderId: 'admin',
            channel: 'dashboard',
            reason: 'admin_edit_requested',
            error: reason,
          });
          if (!updated) {
            return invalidDecisionTransition(decision.id, decision.status, 'edit_requested');
          }
          if (action && (action.status === 'proposed' || action.status === 'approved')) {
            store.updateActionStatus(action.id, 'rejected', { updatedAt: Date.now(), error: reason });
          }
          return NextResponse.json({ ok: true, decision: updated, action: action ? store.getAction(action.id) : null });
        }

        if (operation === 'expire_decision') {
          const reason = typeof body.reason === 'string' ? body.reason : undefined;
          const updated = decisionStore.updateDecisionStatus(decision.id, 'expired', {
            decidedBy: 'admin',
            actorSenderId: 'admin',
            channel: 'dashboard',
            reason: 'admin_expired',
            error: reason,
          });
          if (!updated) {
            return invalidDecisionTransition(decision.id, decision.status, 'expired');
          }
          return NextResponse.json({ ok: true, decision: updated, action: action ? store.getAction(action.id) : null });
        }

        if (decision.status !== 'approved') {
          throw new ValidationError('bad_request', `Decision ${decisionId} must be approved before apply`);
        }
        if (!action) {
          throw new ValidationError('bad_request', `Decision ${decisionId} has no linked learning action`);
        }
        let applied: Record<string, unknown>;
        try {
          applied = applyLearningAction({ store, action, agentId });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          store.updateActionStatus(action.id, 'failed', { updatedAt: Date.now(), error: message });
          const failedDecision = decisionStore.updateDecisionStatus(decision.id, 'failed', {
            reason: 'admin_apply_failed',
            error: message,
          });
          return NextResponse.json({
            error: 'apply_failed',
            decisionId: decision.id,
            actionId: action.id,
            message,
            decision: failedDecision ?? decisionStore.getDecision(decision.id),
            action: store.getAction(action.id),
          }, { status: 400 });
        }
        const updated = decisionStore.updateDecisionStatus(decision.id, 'applied', {
          appliedAt: Date.now(),
          reason: 'admin_applied',
        });
        if (!updated) {
          return invalidDecisionTransition(decision.id, decision.status, 'applied');
        }
        return NextResponse.json({ ok: true, decision: updated, action: store.getAction(action.id), applied });
      } finally {
        store.close();
        decisionStore.close();
      }
    }

    const actionId = typeof body.actionId === 'string' ? body.actionId : '';
    if (!actionId) {
      throw new ValidationError('bad_request', 'Expected actionId');
    }

    const store = openLearningStore();
    try {
      const action = store.getAction(actionId);
      if (!action || action.agentId !== agentId) {
        return NextResponse.json({ error: 'not_found' }, { status: 404 });
      }

      if (operation === 'approve') {
        store.updateActionStatus(actionId, 'approved', { updatedAt: Date.now() });
        return NextResponse.json({ ok: true, action: store.getAction(actionId) });
      }

      if (operation === 'reject') {
        const reason = typeof body.reason === 'string' ? body.reason : undefined;
        store.updateActionStatus(actionId, 'rejected', { updatedAt: Date.now(), error: reason });
        metrics.increment('learning_actions_rejected');
        return NextResponse.json({ ok: true, action: store.getAction(actionId) });
      }

      if (operation === 'apply') {
        if (action.status !== 'approved') {
          throw new ValidationError('bad_request', `Action ${actionId} must be approved before apply`);
        }
        return NextResponse.json({ ok: true, applied: applyLearningAction({ store, action, agentId }) });
      }
    } finally {
      store.close();
    }

    throw new ValidationError('bad_request', 'Unsupported learning operation');
  });
}

function openLearningStore(): LearningStore {
  return new LearningStore(join(DATA_DIR, 'learning.sqlite'));
}

function openDecisionStore(): DecisionStore {
  return new DecisionStore(join(DATA_DIR, 'decision-center.sqlite'));
}

function applyLearningAction(params: {
  store: LearningStore;
  action: LearningActionRecord;
  agentId: string;
}): Record<string, unknown> {
  const config = getAgentConfig(params.agentId).parsed;
  const safetyProfile = parseSafetyProfile(config.safety_profile);
  const learning = normalizeLearningConfig(config.learning);

  if (params.action.actionType === 'memory_candidate') {
    const memoryDbDir = join(DATA_DIR, 'memory-db');
    mkdirSync(memoryDbDir, { recursive: true });
    const memoryStore = new MemoryStore(join(memoryDbDir, `${params.agentId}.sqlite`));
    try {
      const result = applyMemoryCandidateAction({
        memoryStore,
        action: params.action,
        safetyProfile,
        mode: learning.mode,
        agentId: params.agentId,
        reviewStatusOverride: 'approved',
      });
      params.store.updateActionStatus(params.action.id, 'applied', { appliedAt: Date.now() });
      return { kind: 'memory', path: result.entry.path };
    } finally {
      memoryStore.close();
    }
  }

  if (params.action.actionType === 'skill_patch' || params.action.actionType === 'skill_create' || params.action.actionType === 'skill_update_full') {
    const result = applySkillAction({
      workspacePath: join(AGENTS_DIR, params.agentId),
      learningStore: params.store,
      action: params.action,
      safetyProfile,
      mode: learning.mode,
      agentId: params.agentId,
      autoApply: false,
    });
    return { kind: 'skill', skillName: result.skillName, skillPath: result.skillPath };
  }

  params.store.updateActionStatus(params.action.id, 'applied', { appliedAt: Date.now() });
  return { kind: 'none' };
}

function invalidDecisionTransition(decisionId: string, from: DecisionStatus, to: DecisionStatus): NextResponse {
  return NextResponse.json({
    error: 'invalid_transition',
    decisionId,
    from,
    to,
  }, { status: 400 });
}

function summarizePendingDecisionAge(decisions: Array<{ status: DecisionStatus; createdAt: number }>): {
  oldestCreatedAt?: number;
  oldestAgeMs?: number;
  buckets: {
    under1h: number;
    oneTo24h: number;
    oneTo7d: number;
    over7d: number;
  };
} {
  const now = Date.now();
  const hour = 60 * 60 * 1000;
  const day = 24 * hour;
  const summary = {
    oldestCreatedAt: undefined as number | undefined,
    oldestAgeMs: undefined as number | undefined,
    buckets: {
      under1h: 0,
      oneTo24h: 0,
      oneTo7d: 0,
      over7d: 0,
    },
  };

  for (const decision of decisions) {
    if (decision.status !== 'pending') continue;
    const ageMs = Math.max(0, now - decision.createdAt);
    if (summary.oldestAgeMs === undefined || ageMs > summary.oldestAgeMs) {
      summary.oldestAgeMs = ageMs;
      summary.oldestCreatedAt = decision.createdAt;
    }
    if (ageMs < hour) {
      summary.buckets.under1h += 1;
    } else if (ageMs < day) {
      summary.buckets.oneTo24h += 1;
    } else if (ageMs < 7 * day) {
      summary.buckets.oneTo7d += 1;
    } else {
      summary.buckets.over7d += 1;
    }
  }

  return summary;
}

function optionalNumber(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseActionStatus(value: string | null) {
  return value && ACTION_STATUSES.has(value)
    ? value as 'proposed' | 'approved' | 'rejected' | 'applied' | 'failed'
    : undefined;
}

function parseActionType(value: string | null) {
  return value && ACTION_TYPES.has(value)
    ? value as 'memory_candidate' | 'skill_patch' | 'skill_create' | 'skill_update_full' | 'none'
    : undefined;
}

function parseDecisionStatus(value: string | null): DecisionStatus | undefined {
  return value && DECISION_STATUSES.has(value) ? value as DecisionStatus : undefined;
}

function parseDecisionKind(value: string | null): DecisionKind | undefined {
  return value && DECISION_KINDS.has(value) ? value as DecisionKind : undefined;
}

function parseDecisionActor(value: string | null): DecisionActor | undefined {
  return value && DECISION_ACTORS.has(value) ? value as DecisionActor : undefined;
}

function parseSafetyProfile(value: unknown): 'public' | 'trusted' | 'private' {
  return value === 'public' || value === 'trusted' || value === 'private' ? value : 'private';
}

function normalizeLearningConfig(value: unknown): {
  enabled: boolean;
  mode: LearningMode;
  review_interval_turns: number;
  skill_review_min_tool_calls: number;
  max_actions_per_review: number;
  max_input_chars: number;
  artifacts: {
    max_files: number;
    max_file_bytes: number;
    max_total_bytes: number;
    max_prompt_chars: number;
    max_snippet_chars: number;
  };
  approvals: {
    admin: {
      notify: boolean;
      routes: Array<{ channel: string; account_id?: string; peer_id: string; thread_id?: string }>;
      senders: Record<string, Record<string, string[]>>;
      notify_admin_for: Array<'learning_memory' | 'learning_skill' | 'curator_action' | 'tool_approval'>;
    };
  };
} {
  const input = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const artifacts = input.artifacts && typeof input.artifacts === 'object' && !Array.isArray(input.artifacts)
    ? input.artifacts as Record<string, unknown>
    : {};
  const mode: LearningMode = input.mode === 'propose' || input.mode === 'auto_private' || input.mode === 'off'
    ? input.mode
    : 'propose';
  return {
    enabled: input.enabled !== false,
    mode,
    review_interval_turns: finiteNumber(input.review_interval_turns, 10),
    skill_review_min_tool_calls: finiteNumber(input.skill_review_min_tool_calls, 8),
    max_actions_per_review: finiteNumber(input.max_actions_per_review, 8),
    max_input_chars: finiteNumber(input.max_input_chars, 24_000),
    artifacts: {
      max_files: finiteNumber(artifacts.max_files, 32),
      max_file_bytes: finiteNumber(artifacts.max_file_bytes, 65_536),
      max_total_bytes: finiteNumber(artifacts.max_total_bytes, 262_144),
      max_prompt_chars: finiteNumber(artifacts.max_prompt_chars, 24_000),
      max_snippet_chars: finiteNumber(artifacts.max_snippet_chars, 4_000),
    },
    approvals: normalizeLearningApprovals(input.approvals),
  };
}

function normalizeLearningApprovals(value: unknown): {
  admin: {
    notify: boolean;
    routes: Array<{ channel: string; account_id?: string; peer_id: string; thread_id?: string }>;
    senders: Record<string, Record<string, string[]>>;
    notify_admin_for: Array<'learning_memory' | 'learning_skill' | 'curator_action' | 'tool_approval'>;
  };
} {
  const input = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const admin = input.admin && typeof input.admin === 'object' && !Array.isArray(input.admin)
    ? input.admin as Record<string, unknown>
    : {};
  const routes = Array.isArray(admin.routes)
    ? admin.routes.map(normalizeApprovalRoute).filter((route): route is NonNullable<typeof route> => Boolean(route))
    : [];
  return {
    admin: {
      notify: admin.notify === true,
      routes,
      senders: normalizeApprovalSenders(admin.senders),
      notify_admin_for: normalizeDecisionKinds(admin.notify_admin_for),
    },
  };
}

function normalizeApprovalRoute(value: unknown): { channel: string; account_id?: string; peer_id: string; thread_id?: string } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const route = value as Record<string, unknown>;
  const channel = typeof route.channel === 'string' ? route.channel.trim() : '';
  const peerId = typeof route.peer_id === 'string' ? route.peer_id.trim() : '';
  if (!channel || !peerId) return null;
  return {
    channel,
    account_id: typeof route.account_id === 'string' && route.account_id.trim() ? route.account_id.trim() : undefined,
    peer_id: peerId,
    thread_id: typeof route.thread_id === 'string' && route.thread_id.trim() ? route.thread_id.trim() : undefined,
  };
}

function normalizeApprovalSenders(value: unknown): Record<string, Record<string, string[]>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: Record<string, Record<string, string[]>> = {};
  for (const [channel, accounts] of Object.entries(value as Record<string, unknown>)) {
    if (!accounts || typeof accounts !== 'object' || Array.isArray(accounts)) continue;
    const normalizedAccounts: Record<string, string[]> = {};
    for (const [accountId, senders] of Object.entries(accounts as Record<string, unknown>)) {
      if (!Array.isArray(senders)) continue;
      const normalizedSenders = senders
        .filter((sender): sender is string => typeof sender === 'string')
        .map((sender) => sender.trim())
        .filter(Boolean);
      if (normalizedSenders.length > 0) normalizedAccounts[accountId] = normalizedSenders;
    }
    if (Object.keys(normalizedAccounts).length > 0) result[channel] = normalizedAccounts;
  }
  return result;
}

function normalizeDecisionKinds(value: unknown): Array<'learning_memory' | 'learning_skill' | 'curator_action' | 'tool_approval'> {
  const allowed = new Set(['learning_memory', 'learning_skill', 'curator_action', 'tool_approval']);
  const values = Array.isArray(value)
    ? value.filter((entry): entry is 'learning_memory' | 'learning_skill' | 'curator_action' | 'tool_approval' => typeof entry === 'string' && allowed.has(entry))
    : [];
  return values.length > 0 ? values : ['learning_skill', 'curator_action', 'tool_approval'];
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function countBy(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}
