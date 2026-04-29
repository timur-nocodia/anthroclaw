import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { getAgentConfig, setAgentLearningConfig, ValidationError } from '@/lib/agents';
import { LearningStore } from '@backend/learning/store.js';
import { applyMemoryCandidateAction } from '@backend/learning/memory-applier.js';
import { applySkillAction } from '@backend/learning/skill-applier.js';
import { MemoryStore } from '@backend/memory/store.js';
import { metrics } from '@backend/metrics/collector.js';
import type { LearningMode } from '@backend/learning/types.js';

const DATA_DIR = resolve(process.cwd(), '..', 'data');
const AGENTS_DIR = resolve(process.cwd(), '..', 'agents');

const ACTION_STATUSES = new Set(['proposed', 'approved', 'rejected', 'applied', 'failed']);
const ACTION_TYPES = new Set(['memory_candidate', 'skill_patch', 'skill_create', 'skill_update_full', 'none']);

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  return withAuth(async () => {
    const { agentId } = await params;
    const url = new URL(req.url);
    const status = parseActionStatus(url.searchParams.get('status'));
    const actionType = parseActionType(url.searchParams.get('type'));
    const limit = optionalNumber(url.searchParams.get('limit')) ?? 100;
    const offset = optionalNumber(url.searchParams.get('offset')) ?? 0;
    const config = getAgentConfig(agentId).parsed;
    const store = openLearningStore();
    try {
      const actions = store.listActions({ agentId, status, actionType, limit, offset });
      const reviews = store.listReviews({ agentId, limit: 50 });
      const artifacts = store.listArtifacts({ limit: 1000 }).filter((artifact) => artifact.agentId === agentId);
      const snapshots = store.listSkillSnapshots({ agentId, limit: 1000 });
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
          artifactCount: artifacts.length,
          skillSnapshotCount: snapshots.length,
        },
        actions,
        reviews,
        artifacts: artifacts.slice(0, 100),
      });
    } finally {
      store.close();
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
        const config = getAgentConfig(agentId).parsed;
        const safetyProfile = parseSafetyProfile(config.safety_profile);
        const learning = normalizeLearningConfig(config.learning);

        if (action.actionType === 'memory_candidate') {
          const memoryDbDir = join(DATA_DIR, 'memory-db');
          mkdirSync(memoryDbDir, { recursive: true });
          const memoryStore = new MemoryStore(join(memoryDbDir, `${agentId}.sqlite`));
          try {
            const result = applyMemoryCandidateAction({
              memoryStore,
              action,
              safetyProfile,
              mode: learning.mode,
              agentId,
              reviewStatusOverride: 'approved',
            });
            store.updateActionStatus(actionId, 'applied', { appliedAt: Date.now() });
            return NextResponse.json({ ok: true, applied: { kind: 'memory', path: result.entry.path } });
          } finally {
            memoryStore.close();
          }
        }

        if (action.actionType === 'skill_patch' || action.actionType === 'skill_create' || action.actionType === 'skill_update_full') {
          const result = applySkillAction({
            workspacePath: join(AGENTS_DIR, agentId),
            learningStore: store,
            action,
            safetyProfile,
            mode: learning.mode,
            agentId,
            autoApply: false,
          });
          return NextResponse.json({ ok: true, applied: { kind: 'skill', skillName: result.skillName, skillPath: result.skillPath } });
        }

        store.updateActionStatus(actionId, 'applied', { appliedAt: Date.now() });
        return NextResponse.json({ ok: true, applied: { kind: 'none' } });
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
} {
  const input = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const artifacts = input.artifacts && typeof input.artifacts === 'object' && !Array.isArray(input.artifacts)
    ? input.artifacts as Record<string, unknown>
    : {};
  const mode: LearningMode = input.mode === 'propose' || input.mode === 'auto_private' || input.mode === 'off'
    ? input.mode
    : 'off';
  return {
    enabled: input.enabled === true,
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
  };
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
