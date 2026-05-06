import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DecisionCenter } from '../center.js';
import {
  parseBareDecisionReply,
  parseDecisionCallbackData,
  parseDecisionTextCommand,
} from '../events.js';
import { DecisionStore } from '../store.js';

describe('decision event parsing', () => {
  it('parses callback payloads and text commands into normalized selections', () => {
    expect(parseDecisionCallbackData('decision:ABC123:approve')).toEqual({
      shortCode: 'ABC123',
      selected: 'approve',
    });
    expect(parseDecisionCallbackData('approve:legacy')).toBeNull();

    expect(parseDecisionTextCommand('/learn reject abc123')).toEqual({
      shortCode: 'ABC123',
      selected: 'reject',
    });
    expect(parseDecisionTextCommand('/learn approve')).toBeNull();

    expect(parseBareDecisionReply('1')).toBe('approve');
    expect(parseBareDecisionReply('да')).toBe('approve');
    expect(parseBareDecisionReply('2')).toBe('reject');
    expect(parseBareDecisionReply('3')).toBe('edit');
    expect(parseBareDecisionReply('ordinary chat')).toBeNull();
  });
});

describe('DecisionCenter', () => {
  let dir: string;
  let store: DecisionStore;
  let center: DecisionCenter;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'anthroclaw-decision-center-'));
    store = new DecisionStore(join(dir, 'decision-center.sqlite'));
    center = new DecisionCenter({ store });
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('approves a user-scoped decision only for the originating messenger user', () => {
    store.createDecision({
      id: 'decision-1',
      shortCode: 'ABC123',
      kind: 'learning_memory',
      scope: 'user',
      actor: 'originating_user',
      agentId: 'agent-a',
      subject: 'Remember preference',
      body: 'Save this preference.',
      risk: 'low',
      payload: { text: 'Use Russian by default.' },
      originChannel: 'telegram',
      originAccountId: 'main',
      originPeerId: 'peer-1',
      originSenderId: 'sender-1',
      createdAt: 1000,
    });

    const wrongSender = center.resolveEvent({
      shortCode: 'ABC123',
      selected: 'approve',
      channel: 'telegram',
      accountId: 'main',
      peerId: 'peer-1',
      senderId: 'sender-2',
      messageId: 'msg-2',
    });

    expect(wrongSender).toMatchObject({
      handled: true,
      status: 'pending',
      reason: 'unauthorized',
    });
    expect(store.getDecision('decision-1')).toMatchObject({ status: 'pending' });

    const result = center.resolveEvent({
      shortCode: 'ABC123',
      selected: 'approve',
      channel: 'telegram',
      accountId: 'main',
      peerId: 'peer-1',
      senderId: 'sender-1',
      messageId: 'msg-3',
    });

    expect(result).toMatchObject({
      handled: true,
      status: 'approved',
      decision: expect.objectContaining({ id: 'decision-1' }),
    });
    expect(store.getDecision('decision-1')).toMatchObject({
      status: 'approved',
      decidedBy: 'sender-1',
    });
    expect(store.listAuditEvents('decision-1')).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fromStatus: 'pending',
        toStatus: 'approved',
        actorSenderId: 'sender-1',
      }),
    ]));
  });

  it('resolves bare text replies only when exactly one pending decision matches the origin', () => {
    store.createDecision({
      id: 'decision-1',
      shortCode: 'ABC123',
      kind: 'learning_memory',
      scope: 'user',
      actor: 'originating_user',
      agentId: 'agent-a',
      subject: 'Remember preference',
      body: 'Save this preference.',
      risk: 'low',
      payload: { text: 'Use Russian by default.' },
      originChannel: 'whatsapp',
      originAccountId: 'main',
      originPeerId: 'peer-1',
      originSenderId: 'sender-1',
      createdAt: 1000,
    });

    expect(center.resolveTextReply({
      rawText: '1',
      channel: 'whatsapp',
      accountId: 'main',
      peerId: 'peer-1',
      senderId: 'sender-1',
      messageId: 'msg-1',
    })).toMatchObject({ handled: true, status: 'approved' });

    store.createDecision({
      id: 'decision-2',
      shortCode: 'DEF456',
      kind: 'learning_memory',
      scope: 'user',
      actor: 'originating_user',
      agentId: 'agent-a',
      subject: 'Second preference',
      body: 'Save another preference.',
      risk: 'low',
      payload: { text: 'Use short answers.' },
      originChannel: 'whatsapp',
      originAccountId: 'main',
      originPeerId: 'peer-1',
      originSenderId: 'sender-1',
      createdAt: 2000,
    });
    store.createDecision({
      id: 'decision-3',
      shortCode: 'GHI789',
      kind: 'learning_memory',
      scope: 'user',
      actor: 'originating_user',
      agentId: 'agent-a',
      subject: 'Third preference',
      body: 'Save a third preference.',
      risk: 'low',
      payload: { text: 'Avoid summaries.' },
      originChannel: 'whatsapp',
      originAccountId: 'main',
      originPeerId: 'peer-1',
      originSenderId: 'sender-1',
      createdAt: 3000,
    });

    expect(center.resolveTextReply({
      rawText: '2',
      channel: 'whatsapp',
      accountId: 'main',
      peerId: 'peer-1',
      senderId: 'sender-1',
      messageId: 'msg-2',
    })).toMatchObject({
      handled: true,
      status: 'pending',
      reason: 'ambiguous',
    });
    expect(store.getDecision('decision-2')).toMatchObject({ status: 'pending' });
    expect(store.getDecision('decision-3')).toMatchObject({ status: 'pending' });
  });
});
