import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DecisionStore } from '../store.js';

describe('DecisionStore', () => {
  let dir: string;
  let store: DecisionStore;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'anthroclaw-decisions-'));
    dbPath = join(dir, 'decision-center.sqlite');
    store = new DecisionStore(dbPath);
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('bootstraps decision tables', () => {
    expect(store.listTables()).toEqual(expect.arrayContaining([
      'decisions',
      'decision_audit_events',
      'decision_deliveries',
    ]));
  });

  it('creates decisions, records audit, and looks up by short code', () => {
    const decision = store.createDecision({
      id: 'decision-1',
      shortCode: 'ABC123',
      kind: 'learning_memory',
      scope: 'user',
      actor: 'originating_user',
      agentId: 'agent-a',
      learningActionId: 'action-1',
      reviewId: 'review-1',
      subject: 'Remember preferred language',
      body: 'Save that this user prefers Russian responses.',
      risk: 'low',
      payload: { text: 'Prefer Russian responses.' },
      originChannel: 'telegram',
      originAccountId: 'main',
      originPeerId: 'peer-1',
      originSenderId: 'sender-1',
      originMessageId: 'msg-1',
      delivery: [{ channel: 'telegram', status: 'sent', messageId: 'out-1' }],
      expiresAt: 2000,
      createdAt: 1000,
    });

    expect(decision).toMatchObject({
      id: 'decision-1',
      shortCode: 'ABC123',
      status: 'pending',
      payload: { text: 'Prefer Russian responses.' },
      delivery: [{ channel: 'telegram', status: 'sent', messageId: 'out-1' }],
    });
    expect(store.getDecisionByShortCode('abc123')).toMatchObject({ id: 'decision-1' });
    expect(store.listAuditEvents('decision-1')).toEqual([
      expect.objectContaining({
        decisionId: 'decision-1',
        toStatus: 'pending',
        reason: 'created',
        createdAt: 1000,
      }),
    ]);
  });

  it('records delivery attempts and keeps the decision delivery summary current', () => {
    store.createDecision({
      id: 'decision-1',
      shortCode: 'ABC123',
      kind: 'learning_memory',
      scope: 'user',
      actor: 'originating_user',
      agentId: 'agent-a',
      subject: 'Remember preference',
      body: 'Save preference.',
      risk: 'low',
      createdAt: 1000,
    });

    const delivery = store.recordDelivery('decision-1', {
      channel: 'whatsapp',
      accountId: 'main',
      peerId: 'peer-1',
      messageId: 'out-1',
      status: 'sent',
      createdAt: 1100,
    });

    expect(delivery).toMatchObject({
      decisionId: 'decision-1',
      channel: 'whatsapp',
      status: 'sent',
      messageId: 'out-1',
    });
    expect(store.listDeliveries('decision-1')).toEqual([
      expect.objectContaining({ id: delivery.id, status: 'sent' }),
    ]);
    expect(store.getDecision('decision-1')).toMatchObject({
      delivery: [
        expect.objectContaining({
          channel: 'whatsapp',
          messageId: 'out-1',
          status: 'sent',
        }),
      ],
    });
  });

  it('lists decisions by agent, status, kind, and actor', () => {
    store.createDecision({
      id: 'decision-1',
      shortCode: 'ABC123',
      kind: 'learning_skill',
      scope: 'agent',
      actor: 'admin',
      agentId: 'agent-a',
      subject: 'Skill patch',
      body: 'Patch skill.',
      risk: 'medium',
      createdAt: 1000,
    });
    store.createDecision({
      id: 'decision-2',
      shortCode: 'DEF456',
      kind: 'learning_memory',
      scope: 'user',
      actor: 'originating_user',
      agentId: 'agent-a',
      subject: 'Memory',
      body: 'Save memory.',
      risk: 'low',
      createdAt: 2000,
    });
    store.createDecision({
      id: 'decision-3',
      shortCode: 'GHI789',
      kind: 'learning_skill',
      scope: 'agent',
      actor: 'admin',
      agentId: 'agent-b',
      subject: 'Other agent',
      body: 'Patch other skill.',
      risk: 'medium',
      createdAt: 3000,
    });

    expect(store.listDecisions({ agentId: 'agent-a', kind: 'learning_skill', actor: 'admin' }))
      .toEqual([
        expect.objectContaining({ id: 'decision-1' }),
      ]);
    expect(store.listDecisions({ agentId: 'agent-a', status: 'pending' }).map((decision) => decision.id))
      .toEqual(['decision-2', 'decision-1']);
  });

  it('reuses an active decision for the same learning action', () => {
    const first = store.createDecision({
      id: 'decision-1',
      shortCode: 'ABC123',
      kind: 'learning_skill',
      scope: 'agent',
      actor: 'admin',
      agentId: 'agent-a',
      learningActionId: 'action-1',
      subject: 'Skill patch',
      body: 'Patch skill.',
      risk: 'medium',
      createdAt: 1000,
    });
    const duplicate = store.createDecision({
      id: 'decision-duplicate',
      shortCode: 'DUP123',
      kind: 'learning_skill',
      scope: 'agent',
      actor: 'admin',
      agentId: 'agent-a',
      learningActionId: 'action-1',
      subject: 'Duplicate skill patch',
      body: 'Duplicate patch.',
      risk: 'medium',
      createdAt: 2000,
    });

    expect(duplicate).toMatchObject({ id: first.id, shortCode: 'ABC123' });
    expect(store.listDecisions({ agentId: 'agent-a' }).map((decision) => decision.id))
      .toEqual(['decision-1']);
    expect(store.listAuditEvents('decision-1')).toHaveLength(1);

    store.updateDecisionStatus('decision-1', 'rejected', { reason: 'admin_rejected', updatedAt: 3000 });

    const next = store.createDecision({
      id: 'decision-2',
      shortCode: 'DEF456',
      kind: 'learning_skill',
      scope: 'agent',
      actor: 'admin',
      agentId: 'agent-a',
      learningActionId: 'action-1',
      subject: 'Retry skill patch',
      body: 'Retry patch.',
      risk: 'medium',
      createdAt: 4000,
    });

    expect(next).toMatchObject({ id: 'decision-2', shortCode: 'DEF456' });
    expect(store.listDecisions({ agentId: 'agent-a' }).map((decision) => decision.id))
      .toEqual(['decision-2', 'decision-1']);
  });

  it('rejects invalid state transitions without mutating audit history', () => {
    store.createDecision({
      id: 'decision-1',
      shortCode: 'ABC123',
      kind: 'learning_skill',
      scope: 'agent',
      actor: 'admin',
      agentId: 'agent-a',
      subject: 'Skill patch',
      body: 'Patch skill.',
      risk: 'medium',
      createdAt: 1000,
    });
    store.updateDecisionStatus('decision-1', 'expired', { reason: 'admin_expired', updatedAt: 2000 });

    const approved = store.updateDecisionStatus('decision-1', 'approved', { reason: 'late_approve', updatedAt: 3000 });
    const applied = store.updateDecisionStatus('decision-1', 'applied', { reason: 'late_apply', updatedAt: 4000 });

    expect(approved).toBeNull();
    expect(applied).toBeNull();
    expect(store.getDecision('decision-1')).toMatchObject({ status: 'expired', updatedAt: 2000 });
    expect(store.listAuditEvents('decision-1').map((event) => event.toStatus))
      .toEqual(['pending', 'expired']);
  });
});
