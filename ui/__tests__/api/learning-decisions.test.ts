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
