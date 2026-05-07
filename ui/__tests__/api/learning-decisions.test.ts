import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { LearningStore } from '@backend/learning/store.js';
import { DecisionStore } from '@backend/decisions/store.js';

process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long!!';
process.env.ADMIN_EMAIL = 'admin@test.com';
process.env.ADMIN_PASSWORD = 'testpassword123';

let authShouldFail = false;

vi.mock('@/lib/require-auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/require-auth')>(
    '@/lib/require-auth',
  );
  return {
    ...actual,
    requireAuth: vi.fn(async () => {
      if (authShouldFail) {
        throw new actual.AuthError('unauthorized', 'test-no-auth');
      }
      return { email: 'admin@test.com', authMethod: 'cookie' as const };
    }),
  };
});

describe('/api/agents/[agentId]/learning decisions', () => {
  let root: string;
  let learningStore: LearningStore;
  let decisionStore: DecisionStore;

  beforeEach(() => {
    authShouldFail = false;
    root = join(tmpdir(), `anthroclaw-ui-learning-decisions-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(root, 'ui'), { recursive: true });
    mkdirSync(join(root, 'data'), { recursive: true });
    mkdirSync(join(root, 'agents', 'agent-a'), { recursive: true });
    vi.spyOn(process, 'cwd').mockReturnValue(join(root, 'ui'));
    writeFileSync(join(root, 'agents', 'agent-a', 'agent.yml'), [
      'safety_profile: private',
      'routes:',
      '  - channel: telegram',
      '    scope: dm',
      'learning:',
      '  enabled: true',
      '  mode: propose',
    ].join('\n'));
    learningStore = new LearningStore(join(root, 'data', 'learning.sqlite'));
    decisionStore = new DecisionStore(join(root, 'data', 'decision-center.sqlite'));
    vi.resetModules();
  });

  afterEach(() => {
    learningStore?.close();
    decisionStore?.close();
    vi.restoreAllMocks();
    vi.resetModules();
    if (existsSync(root)) rmSync(root, { recursive: true, force: true });
  });

  it('returns decision records beside learning actions', async () => {
    const action = seedSkillAction({ status: 'proposed' });
    decisionStore.createDecision({
      id: 'decision-1',
      shortCode: 'ABC123',
      kind: 'learning_skill',
      scope: 'agent',
      actor: 'admin',
      agentId: 'agent-a',
      learningActionId: action.id,
      reviewId: action.reviewId,
      subject: 'Create publishing skill',
      body: 'Reusable workflow.',
      risk: 'medium',
      payload: action.payload,
      createdAt: 2000,
    });

    const { GET } = await import('@/app/api/agents/[agentId]/learning/route');
    const res = await GET(
      new NextRequest('http://localhost:3000/api/agents/agent-a/learning'),
      { params: Promise.resolve({ agentId: 'agent-a' }) },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.decisions).toEqual([
      expect.objectContaining({
        id: 'decision-1',
        kind: 'learning_skill',
        status: 'pending',
        learningActionId: action.id,
      }),
    ]);
    expect(body.summary.pendingDecisions).toBe(1);
  });

  it('summarizes pending decision age for stale queue visibility', async () => {
    const now = 10 * 24 * 60 * 60 * 1000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const hour = 60 * 60 * 1000;
    const day = 24 * hour;

    decisionStore.createDecision({
      id: 'decision-fresh',
      shortCode: 'AGE001',
      kind: 'learning_skill',
      scope: 'agent',
      actor: 'admin',
      agentId: 'agent-a',
      subject: 'Fresh proposal',
      body: 'Just created.',
      risk: 'medium',
      payload: {},
      createdAt: now - 30 * 60 * 1000,
    });
    decisionStore.createDecision({
      id: 'decision-day-old',
      shortCode: 'AGE002',
      kind: 'learning_skill',
      scope: 'agent',
      actor: 'admin',
      agentId: 'agent-a',
      subject: 'Day-old proposal',
      body: 'Needs operator review.',
      risk: 'medium',
      payload: {},
      createdAt: now - 25 * hour,
    });
    decisionStore.createDecision({
      id: 'decision-week-old',
      shortCode: 'AGE003',
      kind: 'learning_skill',
      scope: 'agent',
      actor: 'admin',
      agentId: 'agent-a',
      subject: 'Week-old proposal',
      body: 'Stale operator review.',
      risk: 'medium',
      payload: {},
      createdAt: now - 8 * day,
    });
    decisionStore.createDecision({
      id: 'decision-approved',
      shortCode: 'AGE004',
      kind: 'learning_skill',
      scope: 'agent',
      actor: 'admin',
      status: 'approved',
      agentId: 'agent-a',
      subject: 'Approved proposal',
      body: 'Not pending.',
      risk: 'medium',
      payload: {},
      createdAt: now - 12 * day,
    });

    const { GET } = await import('@/app/api/agents/[agentId]/learning/route');
    const res = await GET(
      new NextRequest('http://localhost:3000/api/agents/agent-a/learning'),
      { params: Promise.resolve({ agentId: 'agent-a' }) },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary.pendingDecisionAge).toEqual({
      oldestCreatedAt: now - 8 * day,
      oldestAgeMs: 8 * day,
      buckets: {
        under1h: 1,
        oneTo24h: 0,
        oneTo7d: 1,
        over7d: 1,
      },
    });
  });

  it('does not show an older failed review as the current learning failure', async () => {
    const failed = learningStore.createReview({
      id: 'review-old-failed',
      agentId: 'agent-a',
      trigger: 'turn_interval',
      mode: 'propose',
      startedAt: 1000,
    });
    learningStore.completeReview(failed.id, {
      status: 'failed',
      completedAt: 1100,
      error: 'old transient failure',
    });
    const completed = learningStore.createReview({
      id: 'review-new-completed',
      agentId: 'agent-a',
      trigger: 'turn_interval',
      mode: 'propose',
      startedAt: 2000,
    });
    learningStore.completeReview(completed.id, {
      status: 'completed',
      completedAt: 2100,
      output: { actionCount: 0 },
    });

    const { GET } = await import('@/app/api/agents/[agentId]/learning/route');
    const res = await GET(
      new NextRequest('http://localhost:3000/api/agents/agent-a/learning'),
      { params: Promise.resolve({ agentId: 'agent-a' }) },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary.lastReviewAt).toBe(2100);
    expect(body.summary.lastFailure).toBeUndefined();
  });

  it('filters decision center records by status, kind, and actor', async () => {
    decisionStore.createDecision({
      id: 'decision-pending-skill-admin',
      shortCode: 'SKL111',
      kind: 'learning_skill',
      scope: 'agent',
      actor: 'admin',
      agentId: 'agent-a',
      subject: 'Create sales skill',
      body: 'Reusable workflow.',
      risk: 'medium',
      payload: {},
      createdAt: 3000,
    });
    decisionStore.createDecision({
      id: 'decision-approved-skill-admin',
      shortCode: 'SKL222',
      kind: 'learning_skill',
      scope: 'agent',
      actor: 'admin',
      status: 'approved',
      agentId: 'agent-a',
      subject: 'Create publishing skill',
      body: 'Reusable workflow.',
      risk: 'medium',
      payload: {},
      createdAt: 2000,
    });
    decisionStore.createDecision({
      id: 'decision-pending-memory-user',
      shortCode: 'MEM111',
      kind: 'learning_memory',
      scope: 'user',
      actor: 'originating_user',
      agentId: 'agent-a',
      subject: 'Remember preference',
      body: 'Save user preference.',
      risk: 'low',
      payload: {},
      createdAt: 1000,
    });

    const { GET } = await import('@/app/api/agents/[agentId]/learning/route');
    const res = await GET(
      new NextRequest('http://localhost:3000/api/agents/agent-a/learning?decisionStatus=pending&decisionKind=learning_skill&decisionActor=admin'),
      { params: Promise.resolve({ agentId: 'agent-a' }) },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.decisions.map((decision: { id: string }) => decision.id)).toEqual(['decision-pending-skill-admin']);
    expect(body.summary.pendingDecisions).toBe(1);
  });

  it('returns decision audit events and delivery attempts for dashboard inspection', async () => {
    const action = seedSkillAction({ status: 'proposed' });
    decisionStore.createDecision({
      id: 'decision-1',
      shortCode: 'ABC123',
      kind: 'learning_skill',
      scope: 'agent',
      actor: 'admin',
      agentId: 'agent-a',
      learningActionId: action.id,
      reviewId: action.reviewId,
      subject: 'Create publishing skill',
      body: 'Reusable workflow.',
      risk: 'medium',
      payload: action.payload,
      createdAt: 2000,
    });
    decisionStore.recordDelivery('decision-1', {
      channel: 'telegram',
      accountId: 'main',
      peerId: '48705953',
      messageId: 'tg-msg-1',
      status: 'sent',
      createdAt: 2100,
    });
    decisionStore.updateDecisionStatus('decision-1', 'approved', {
      updatedAt: 2200,
      decidedBy: 'admin',
      actorSenderId: '48705953',
      channel: 'telegram',
      reason: 'admin_approved',
    });

    const { GET } = await import('@/app/api/agents/[agentId]/learning/route');
    const res = await GET(
      new NextRequest('http://localhost:3000/api/agents/agent-a/learning'),
      { params: Promise.resolve({ agentId: 'agent-a' }) },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.decisions[0]).toMatchObject({
      id: 'decision-1',
      status: 'approved',
      delivery: [
        expect.objectContaining({
          channel: 'telegram',
          accountId: 'main',
          peerId: '48705953',
          messageId: 'tg-msg-1',
          status: 'sent',
        }),
      ],
      auditEvents: [
        expect.objectContaining({ toStatus: 'pending', reason: 'created' }),
        expect.objectContaining({
          fromStatus: 'pending',
          toStatus: 'approved',
          actorSenderId: '48705953',
          channel: 'telegram',
          reason: 'admin_approved',
        }),
      ],
    });
  });

  it('returns learning admin approval config for dashboard saves', async () => {
    writeFileSync(join(root, 'agents', 'agent-a', 'agent.yml'), [
      'safety_profile: private',
      'routes:',
      '  - channel: telegram',
      '    scope: dm',
      'learning:',
      '  enabled: true',
      '  mode: propose',
      '  approvals:',
      '    admin:',
      '      notify: true',
      '      routes:',
      '        - channel: telegram',
      '          account_id: main',
      '          peer_id: "48705953"',
      '      senders:',
      '        telegram:',
      '          main:',
      '            - "48705953"',
      '      notify_admin_for:',
      '        - learning_skill',
    ].join('\n'));

    const { GET } = await import('@/app/api/agents/[agentId]/learning/route');
    const res = await GET(
      new NextRequest('http://localhost:3000/api/agents/agent-a/learning'),
      { params: Promise.resolve({ agentId: 'agent-a' }) },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.config.learning.approvals.admin).toMatchObject({
      notify: true,
      routes: [expect.objectContaining({ channel: 'telegram', account_id: 'main', peer_id: '48705953' })],
      senders: { telegram: { main: ['48705953'] } },
      notify_admin_for: ['learning_skill'],
    });
  });

  it('approves and applies a learning skill decision', async () => {
    const action = seedSkillAction({ status: 'proposed' });
    decisionStore.createDecision({
      id: 'decision-1',
      shortCode: 'ABC123',
      kind: 'learning_skill',
      scope: 'agent',
      actor: 'admin',
      agentId: 'agent-a',
      learningActionId: action.id,
      reviewId: action.reviewId,
      subject: 'Create publishing skill',
      body: 'Reusable workflow.',
      risk: 'medium',
      payload: action.payload,
      createdAt: 2000,
    });

    const { PATCH } = await import('@/app/api/agents/[agentId]/learning/route');
    const approve = await PATCH(jsonRequest('/api/agents/agent-a/learning', {
      operation: 'approve_decision',
      decisionId: 'decision-1',
    }), { params: Promise.resolve({ agentId: 'agent-a' }) });
    expect(approve.status).toBe(200);
    expect(learningStore.getAction(action.id)).toMatchObject({ status: 'approved' });
    expect(decisionStore.getDecision('decision-1')).toMatchObject({ status: 'approved', decidedBy: 'admin' });

    const apply = await PATCH(jsonRequest('/api/agents/agent-a/learning', {
      operation: 'apply_decision',
      decisionId: 'decision-1',
    }), { params: Promise.resolve({ agentId: 'agent-a' }) });

    expect(apply.status).toBe(200);
    expect(learningStore.getAction(action.id)).toMatchObject({ status: 'applied' });
    expect(decisionStore.getDecision('decision-1')).toMatchObject({ status: 'applied' });
    expect(readFileSync(join(root, 'agents', 'agent-a', '.claude', 'skills', 'publishing', 'SKILL.md'), 'utf8'))
      .toContain('Publishing');
  });

  it('fails stale skill decision apply without mutating the skill file', async () => {
    const originalSkill = [
      '---',
      'name: publishing',
      'description: Publishing rules',
      '---',
      '# Publishing',
      '',
      'Always ask before publishing.',
      '',
    ].join('\n');
    const changedSkill = `${originalSkill}\nManual admin edit.\n`;
    const skillDir = join(root, 'agents', 'agent-a', '.claude', 'skills', 'publishing');
    const skillPath = join(skillDir, 'SKILL.md');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(skillPath, changedSkill, 'utf8');

    const review = learningStore.createReview({
      id: 'review-stale',
      agentId: 'agent-a',
      trigger: 'manual',
      mode: 'propose',
    });
    const action = learningStore.addAction({
      id: 'action-stale',
      reviewId: review.id,
      agentId: 'agent-a',
      actionType: 'skill_patch',
      status: 'approved',
      confidence: 0.8,
      title: 'Patch publishing skill',
      rationale: 'Reusable workflow.',
      payload: {
        skillName: 'publishing',
        oldText: 'Always ask before publishing.',
        newText: 'Always ask before publishing or scheduling.',
        baseContentHash: sha256(originalSkill),
      },
      createdAt: 1000,
    });
    decisionStore.createDecision({
      id: 'decision-stale',
      shortCode: 'STL123',
      kind: 'learning_skill',
      scope: 'agent',
      actor: 'admin',
      status: 'approved',
      agentId: 'agent-a',
      learningActionId: action.id,
      reviewId: action.reviewId,
      subject: 'Patch publishing skill',
      body: 'Reusable workflow.',
      risk: 'medium',
      payload: action.payload,
      createdAt: 2000,
    });

    const { PATCH } = await import('@/app/api/agents/[agentId]/learning/route');
    const res = await PATCH(jsonRequest('/api/agents/agent-a/learning', {
      operation: 'apply_decision',
      decisionId: 'decision-stale',
    }), { params: Promise.resolve({ agentId: 'agent-a' }) });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: 'apply_failed',
      decisionId: 'decision-stale',
      actionId: 'action-stale',
    });
    expect(readFileSync(skillPath, 'utf8')).toBe(changedSkill);
    expect(learningStore.getAction(action.id)).toMatchObject({ status: 'failed' });
    expect(decisionStore.getDecision('decision-stale')).toMatchObject({ status: 'failed' });
    expect(decisionStore.listAuditEvents('decision-stale').map((event) => event.toStatus))
      .toEqual(['approved', 'failed']);
  });

  it('requests edits and expires pending decisions from the dashboard', async () => {
    const action = seedSkillAction({ status: 'proposed' });
    decisionStore.createDecision({
      id: 'decision-edit',
      shortCode: 'EDT123',
      kind: 'learning_skill',
      scope: 'agent',
      actor: 'admin',
      agentId: 'agent-a',
      learningActionId: action.id,
      reviewId: action.reviewId,
      subject: 'Create publishing skill',
      body: 'Reusable workflow.',
      risk: 'medium',
      payload: action.payload,
      createdAt: 2000,
    });
    decisionStore.createDecision({
      id: 'decision-expire',
      shortCode: 'EXP123',
      kind: 'learning_skill',
      scope: 'agent',
      actor: 'admin',
      agentId: 'agent-a',
      subject: 'Create stale skill',
      body: 'Old proposal.',
      risk: 'medium',
      payload: {},
      createdAt: 2100,
    });

    const { PATCH } = await import('@/app/api/agents/[agentId]/learning/route');
    const edit = await PATCH(jsonRequest('/api/agents/agent-a/learning', {
      operation: 'request_edit_decision',
      decisionId: 'decision-edit',
      reason: 'needs narrower scope',
    }), { params: Promise.resolve({ agentId: 'agent-a' }) });
    const expire = await PATCH(jsonRequest('/api/agents/agent-a/learning', {
      operation: 'expire_decision',
      decisionId: 'decision-expire',
      reason: 'stale proposal',
    }), { params: Promise.resolve({ agentId: 'agent-a' }) });

    expect(edit.status).toBe(200);
    expect(expire.status).toBe(200);
    expect(decisionStore.getDecision('decision-edit')).toMatchObject({ status: 'edit_requested', decidedBy: 'admin', error: 'needs narrower scope' });
    expect(decisionStore.getDecision('decision-expire')).toMatchObject({ status: 'expired', decidedBy: 'admin', error: 'stale proposal' });
    expect(learningStore.getAction(action.id)).toMatchObject({ status: 'rejected', error: 'needs narrower scope' });
    expect(decisionStore.listAuditEvents('decision-edit')).toEqual(expect.arrayContaining([
      expect.objectContaining({ fromStatus: 'pending', toStatus: 'edit_requested', reason: 'admin_edit_requested' }),
    ]));
    expect(decisionStore.listAuditEvents('decision-expire')).toEqual(expect.arrayContaining([
      expect.objectContaining({ fromStatus: 'pending', toStatus: 'expired', reason: 'admin_expired' }),
    ]));
  });

  it('rejects a pending decision from the dashboard and marks the linked learning action rejected', async () => {
    const action = seedSkillAction({ status: 'proposed' });
    decisionStore.createDecision({
      id: 'decision-reject',
      shortCode: 'REJ123',
      kind: 'learning_skill',
      scope: 'agent',
      actor: 'admin',
      agentId: 'agent-a',
      learningActionId: action.id,
      reviewId: action.reviewId,
      subject: 'Create publishing skill',
      body: 'Reusable workflow.',
      risk: 'medium',
      payload: action.payload,
      createdAt: 2000,
    });

    const { PATCH } = await import('@/app/api/agents/[agentId]/learning/route');
    const res = await PATCH(jsonRequest('/api/agents/agent-a/learning', {
      operation: 'reject_decision',
      decisionId: 'decision-reject',
      reason: 'too broad',
    }), { params: Promise.resolve({ agentId: 'agent-a' }) });

    expect(res.status).toBe(200);
    expect(decisionStore.getDecision('decision-reject')).toMatchObject({
      status: 'rejected',
      decidedBy: 'admin',
      error: 'too broad',
    });
    expect(learningStore.getAction(action.id)).toMatchObject({
      status: 'rejected',
      error: 'too broad',
    });
    expect(decisionStore.listAuditEvents('decision-reject')).toEqual(expect.arrayContaining([
      expect.objectContaining({ fromStatus: 'pending', toStatus: 'rejected', reason: 'admin_rejected' }),
    ]));
  });

  it('rejects dashboard transitions for already terminal decisions', async () => {
    const action = seedSkillAction({ status: 'proposed' });
    decisionStore.createDecision({
      id: 'decision-expired',
      shortCode: 'EXP123',
      kind: 'learning_skill',
      scope: 'agent',
      actor: 'admin',
      status: 'expired',
      agentId: 'agent-a',
      learningActionId: action.id,
      reviewId: action.reviewId,
      subject: 'Create stale skill',
      body: 'Old proposal.',
      risk: 'medium',
      payload: action.payload,
      createdAt: 2000,
    });

    const { PATCH } = await import('@/app/api/agents/[agentId]/learning/route');
    const res = await PATCH(jsonRequest('/api/agents/agent-a/learning', {
      operation: 'approve_decision',
      decisionId: 'decision-expired',
    }), { params: Promise.resolve({ agentId: 'agent-a' }) });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'invalid_transition' });
    expect(decisionStore.getDecision('decision-expired')).toMatchObject({ status: 'expired' });
    expect(learningStore.getAction(action.id)).toMatchObject({ status: 'proposed' });
    expect(decisionStore.listAuditEvents('decision-expired').map((event) => event.toStatus))
      .toEqual(['expired']);
  });

  it('resends a pending decision through the runtime gateway', async () => {
    const resendDecisionPrompt = vi.fn(async () => ({
      ok: true,
      reason: 'resent',
      deliveries: [
        {
          id: 'delivery-1',
          decisionId: 'decision-1',
          channel: 'telegram',
          accountId: 'main',
          peerId: '48705953',
          messageId: 'resent-msg-1',
          status: 'sent',
        },
      ],
      decision: { id: 'decision-1', status: 'pending' },
    }));
    vi.doMock('@/lib/gateway', () => ({
      getGateway: vi.fn(async () => ({ resendDecisionPrompt })),
    }));

    const { PATCH } = await import('@/app/api/agents/[agentId]/learning/route');
    const res = await PATCH(jsonRequest('/api/agents/agent-a/learning', {
      operation: 'resend_decision',
      decisionId: 'decision-1',
    }), { params: Promise.resolve({ agentId: 'agent-a' }) });

    expect(res.status).toBe(200);
    expect(resendDecisionPrompt).toHaveBeenCalledWith('decision-1', 'agent-a');
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      resend: {
        ok: true,
        reason: 'resent',
        deliveries: [expect.objectContaining({ messageId: 'resent-msg-1', status: 'sent' })],
      },
    });
  });

  function seedSkillAction(input: { status: 'proposed' | 'approved' }) {
    const review = learningStore.createReview({
      id: 'review-1',
      agentId: 'agent-a',
      trigger: 'manual',
      mode: 'propose',
    });
    return learningStore.addAction({
      id: 'action-1',
      reviewId: review.id,
      agentId: 'agent-a',
      actionType: 'skill_create',
      status: input.status,
      confidence: 0.8,
      title: 'Create publishing skill',
      rationale: 'Reusable workflow.',
      payload: {
        skillName: 'publishing',
        body: '# Publishing\n\nUse this skill for publishing workflows.\n',
      },
      createdAt: 1000,
    });
  }
});

function jsonRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3000'), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
