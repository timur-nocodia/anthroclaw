import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Gateway } from '../../gateway.js';
import type { CallbackEvent, InboundMessage } from '../../channels/types.js';
import { LearningStore } from '../../learning/store.js';
import { MemoryStore } from '../../memory/store.js';
import { DecisionCenter } from '../center.js';
import { DecisionStore } from '../store.js';

describe('Gateway decision wiring', () => {
  let dir: string;
  let store: DecisionStore;
  let learningStore: LearningStore;
  let memoryStore: MemoryStore;
  let gateway: Gateway;
  let sendText: ReturnType<typeof vi.fn>;
  let answerCallbackQuery: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'anthroclaw-gateway-decisions-'));
    store = new DecisionStore(join(dir, 'decision-center.sqlite'));
    learningStore = new LearningStore(join(dir, 'learning.sqlite'));
    memoryStore = new MemoryStore(join(dir, 'memory.sqlite'));
    gateway = new Gateway();
    sendText = vi.fn(async () => 'ack-msg');
    answerCallbackQuery = vi.fn(async () => undefined);
    (gateway as any).decisionStore = store;
    (gateway as any).decisionCenter = new DecisionCenter({
      store,
      isAdminEvent: (decision, event) => (gateway as any).isAdminDecisionEvent(decision, event),
    });
    (gateway as any).learningStore = learningStore;
    (gateway as any).agents = new Map([
      ['agent-a', {
        id: 'agent-a',
        memoryStore,
        config: {
          safety_profile: 'private',
          learning: {
            mode: 'propose',
            approvals: {
              admin: {
                notify: true,
                routes: [
                  { channel: 'telegram', account_id: 'main', peer_id: 'admin-peer', thread_id: 'topic-1' },
                ],
                senders: {
                  telegram: {
                    main: ['admin-sender'],
                  },
                },
                notify_admin_for: ['learning_skill'],
              },
            },
          },
        },
      }],
    ]);
    (gateway as any).channels = new Map([
      ['telegram', { answerCallbackQuery, sendText }],
      ['whatsapp', { sendText }],
    ]);
  });

  afterEach(() => {
    store.close();
    learningStore.close();
    memoryStore.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('resolves decision callback payloads before legacy approval or model callbacks', async () => {
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
      payload: { text: 'Use Russian by default.' },
      originChannel: 'telegram',
      originAccountId: 'main',
      originPeerId: 'peer-1',
      originSenderId: 'sender-1',
      createdAt: 1000,
    });

    await gateway.handleCallbackQuery(makeCallback({
      data: 'decision:ABC123:approve',
    }));

    expect(store.getDecision('decision-1')).toMatchObject({
      status: 'approved',
      decidedBy: 'sender-1',
    });
    expect(answerCallbackQuery).toHaveBeenCalledWith('cb-1', expect.stringMatching(/approved/i), 'main');
  });

  it('handles bare text fallback before normal dispatch when unambiguous', async () => {
    store.createDecision({
      id: 'decision-2',
      shortCode: 'DEF456',
      kind: 'learning_memory',
      scope: 'user',
      actor: 'originating_user',
      agentId: 'agent-a',
      subject: 'Remember preference',
      body: 'Save preference.',
      risk: 'low',
      payload: { text: 'Use short answers.' },
      originChannel: 'whatsapp',
      originAccountId: 'main',
      originPeerId: 'peer-1',
      originSenderId: 'sender-1',
      createdAt: 1000,
    });

    const handled = await (gateway as any).handleDecisionTextReply(makeMessage({ text: '2' }));

    expect(handled).toBe(true);
    expect(store.getDecision('decision-2')).toMatchObject({
      status: 'rejected',
      decidedBy: 'sender-1',
    });
    expect(sendText).toHaveBeenCalledWith('peer-1', expect.stringMatching(/rejected/i), {
      accountId: 'main',
      threadId: undefined,
    });
  });

  it('delivers user decisions to the origin channel with callback controls when available', async () => {
    const decision = store.createDecision({
      id: 'decision-3',
      shortCode: 'GHI789',
      kind: 'learning_memory',
      scope: 'user',
      actor: 'originating_user',
      agentId: 'agent-a',
      subject: 'Remember preference',
      body: 'Save preference.',
      risk: 'low',
      payload: { text: 'Use Russian replies.' },
      originChannel: 'telegram',
      originAccountId: 'main',
      originPeerId: 'peer-1',
      originSenderId: 'sender-1',
      createdAt: 1000,
    });

    await (gateway as any).deliverDecisionPrompt(decision);

    expect(sendText).toHaveBeenCalledWith('peer-1', expect.stringContaining('GHI789'), {
      accountId: 'main',
      threadId: undefined,
      buttons: [[
        { text: 'Save', callbackData: 'decision:GHI789:approve' },
        { text: 'Skip', callbackData: 'decision:GHI789:reject' },
        { text: 'Edit', callbackData: 'decision:GHI789:edit' },
      ]],
    });
    expect(store.listDeliveries('decision-3')).toEqual([
      expect.objectContaining({
        channel: 'telegram',
        accountId: 'main',
        peerId: 'peer-1',
        messageId: 'ack-msg',
        status: 'sent',
      }),
    ]);
  });

  it('delivers admin decisions to configured admin routes and accepts admin chat commands', async () => {
    const decision = store.createDecision({
      id: 'decision-admin-1',
      shortCode: 'ADM123',
      kind: 'learning_skill',
      scope: 'agent',
      actor: 'admin',
      agentId: 'agent-a',
      subject: 'Create publishing skill',
      body: 'Reusable workflow.',
      risk: 'medium',
      payload: { skillName: 'publishing' },
      createdAt: 1000,
    });

    await (gateway as any).deliverDecisionPrompt(decision);

    expect(sendText).toHaveBeenCalledWith('admin-peer', expect.stringContaining('ADM123'), {
      accountId: 'main',
      threadId: 'topic-1',
      buttons: [[
        { text: 'Save', callbackData: 'decision:ADM123:approve' },
        { text: 'Skip', callbackData: 'decision:ADM123:reject' },
        { text: 'Edit', callbackData: 'decision:ADM123:edit' },
      ]],
    });
    expect(store.listDeliveries('decision-admin-1')).toEqual([
      expect.objectContaining({
        channel: 'telegram',
        accountId: 'main',
        peerId: 'admin-peer',
        messageId: 'ack-msg',
        status: 'sent',
      }),
    ]);

    const handled = await (gateway as any).handleDecisionTextReply(makeMessage({
      channel: 'telegram',
      accountId: 'main',
      peerId: 'admin-peer',
      senderId: 'admin-sender',
      threadId: 'topic-1',
      text: '/learn approve ADM123',
    }));

    expect(handled).toBe(true);
    expect(store.getDecision('decision-admin-1')).toMatchObject({
      status: 'approved',
      decidedBy: 'admin-sender',
    });
  });

  it('rejects admin decision commands from non-allowlisted senders', async () => {
    store.createDecision({
      id: 'decision-admin-unauthorized',
      shortCode: 'ADM401',
      kind: 'learning_skill',
      scope: 'agent',
      actor: 'admin',
      agentId: 'agent-a',
      subject: 'Create publishing skill',
      body: 'Reusable workflow.',
      risk: 'medium',
      payload: { skillName: 'publishing' },
      createdAt: 1000,
    });

    const handled = await (gateway as any).handleDecisionTextReply(makeMessage({
      channel: 'telegram',
      accountId: 'main',
      peerId: 'admin-peer',
      senderId: 'ordinary-user',
      threadId: 'topic-1',
      text: '/learn approve ADM401',
    }));

    expect(handled).toBe(true);
    expect(store.getDecision('decision-admin-unauthorized')).toMatchObject({
      status: 'pending',
      decidedBy: undefined,
    });
    expect(sendText).toHaveBeenCalledWith('admin-peer', expect.stringMatching(/not authorized/i), {
      accountId: 'main',
      threadId: 'topic-1',
    });
  });

  it('renders admin decisions as text on channels without callbacks and accepts command replies', async () => {
    const agent = (gateway as any).agents.get('agent-a');
    agent.config.learning.approvals.admin.routes = [
      { channel: 'whatsapp', account_id: 'main', peer_id: 'admin-wa-peer' },
    ];
    agent.config.learning.approvals.admin.senders = {
      whatsapp: {
        main: ['admin-wa-sender'],
      },
    };

    const decision = store.createDecision({
      id: 'decision-admin-whatsapp',
      shortCode: 'WHA123',
      kind: 'learning_skill',
      scope: 'agent',
      actor: 'admin',
      agentId: 'agent-a',
      subject: 'Create sales skill',
      body: 'Reusable workflow.',
      risk: 'medium',
      payload: { skillName: 'sales' },
      createdAt: 1000,
    });

    await (gateway as any).deliverDecisionPrompt(decision);

    expect(sendText).toHaveBeenCalledWith('admin-wa-peer', expect.stringContaining('/learn approve WHA123'), {
      accountId: 'main',
      threadId: undefined,
      buttons: undefined,
    });

    const handled = await (gateway as any).handleDecisionTextReply(makeMessage({
      channel: 'whatsapp',
      accountId: 'main',
      peerId: 'admin-wa-peer',
      senderId: 'admin-wa-sender',
      text: '/learn approve WHA123',
    }));

    expect(handled).toBe(true);
    expect(store.getDecision('decision-admin-whatsapp')).toMatchObject({
      status: 'approved',
      decidedBy: 'admin-wa-sender',
    });
  });

  it('resends pending decisions through the same delivery targets', async () => {
    store.createDecision({
      id: 'decision-admin-resend',
      shortCode: 'RSN123',
      kind: 'learning_skill',
      scope: 'agent',
      actor: 'admin',
      agentId: 'agent-a',
      subject: 'Create sales skill',
      body: 'Reusable operator workflow.',
      risk: 'medium',
      payload: { skillName: 'sales' },
      createdAt: 1000,
    });

    const result = await gateway.resendDecisionPrompt('decision-admin-resend', 'agent-a');

    expect(result).toMatchObject({ ok: true, reason: 'resent' });
    expect(sendText).toHaveBeenCalledWith('admin-peer', expect.stringContaining('RSN123'), {
      accountId: 'main',
      threadId: 'topic-1',
      buttons: [[
        { text: 'Save', callbackData: 'decision:RSN123:approve' },
        { text: 'Skip', callbackData: 'decision:RSN123:reject' },
        { text: 'Edit', callbackData: 'decision:RSN123:edit' },
      ]],
    });
    expect(result.deliveries).toEqual([
      expect.objectContaining({
        channel: 'telegram',
        accountId: 'main',
        peerId: 'admin-peer',
        messageId: 'ack-msg',
        status: 'sent',
      }),
    ]);
  });

  it('does not resend already resolved decisions', async () => {
    store.createDecision({
      id: 'decision-admin-resolved',
      shortCode: 'RSN999',
      kind: 'learning_skill',
      scope: 'agent',
      actor: 'admin',
      agentId: 'agent-a',
      status: 'approved',
      subject: 'Create sales skill',
      body: 'Reusable operator workflow.',
      risk: 'medium',
      payload: { skillName: 'sales' },
      createdAt: 1000,
    });

    const result = await gateway.resendDecisionPrompt('decision-admin-resolved', 'agent-a');

    expect(result).toEqual({
      ok: false,
      reason: 'not_pending',
      deliveries: [],
      decision: expect.objectContaining({ id: 'decision-admin-resolved', status: 'approved' }),
    });
    expect(sendText).not.toHaveBeenCalled();
  });

  it('applies approved learning memory decisions to the agent memory store', async () => {
    const review = learningStore.createReview({
      id: 'review-1',
      agentId: 'agent-a',
      trigger: 'user_correction',
      mode: 'propose',
    });
    const action = learningStore.addAction({
      id: 'action-1',
      reviewId: review.id,
      agentId: 'agent-a',
      actionType: 'memory_candidate',
      status: 'proposed',
      confidence: 0.7,
      title: 'Remember preferred language',
      rationale: 'User approved the learning proposal.',
      payload: {
        kind: 'preference',
        text: 'The user wants Russian replies by default.',
        reason: 'User approved this messenger learning proposal.',
      },
      createdAt: 1000,
    });
    store.createDecision({
      id: 'decision-4',
      shortCode: 'JKL012',
      kind: 'learning_memory',
      scope: 'user',
      actor: 'originating_user',
      agentId: 'agent-a',
      learningActionId: action.id,
      reviewId: review.id,
      subject: 'Remember preferred language',
      body: 'Save preference.',
      risk: 'low',
      payload: action.payload,
      originChannel: 'whatsapp',
      originAccountId: 'main',
      originPeerId: 'peer-1',
      originSenderId: 'sender-1',
      createdAt: 1000,
    });

    const handled = await (gateway as any).handleDecisionTextReply(makeMessage({ text: '1' }));

    expect(handled).toBe(true);
    expect(learningStore.getAction('action-1')).toMatchObject({ status: 'applied' });
    expect(store.getDecision('decision-4')).toMatchObject({ status: 'applied' });
    expect(memoryStore.textSearch('Russian replies default', 5)).toHaveLength(1);
  });

  it('marks linked learning actions rejected when a memory decision is rejected', async () => {
    const review = learningStore.createReview({
      id: 'review-reject',
      agentId: 'agent-a',
      trigger: 'user_correction',
      mode: 'propose',
    });
    const action = learningStore.addAction({
      id: 'action-reject',
      reviewId: review.id,
      agentId: 'agent-a',
      actionType: 'memory_candidate',
      status: 'proposed',
      confidence: 0.7,
      title: 'Remember preferred language',
      rationale: 'User rejected the learning proposal.',
      payload: {
        kind: 'preference',
        text: 'The user wants short replies.',
        reason: 'Proposed from messenger interaction.',
      },
      createdAt: 1000,
    });
    store.createDecision({
      id: 'decision-reject',
      shortCode: 'REJ123',
      kind: 'learning_memory',
      scope: 'user',
      actor: 'originating_user',
      agentId: 'agent-a',
      learningActionId: action.id,
      reviewId: review.id,
      subject: 'Remember preferred language',
      body: 'Save preference.',
      risk: 'low',
      payload: action.payload,
      originChannel: 'whatsapp',
      originAccountId: 'main',
      originPeerId: 'peer-1',
      originSenderId: 'sender-1',
      createdAt: 1000,
    });

    const handled = await (gateway as any).handleDecisionTextReply(makeMessage({ text: '2' }));

    expect(handled).toBe(true);
    expect(learningStore.getAction(action.id)).toMatchObject({ status: 'rejected' });
    expect(store.getDecision('decision-reject')).toMatchObject({ status: 'rejected' });
    expect(memoryStore.textSearch('short replies', 5)).toHaveLength(0);
  });
});

function makeCallback(overrides: Partial<CallbackEvent> = {}): CallbackEvent {
  return {
    channel: 'telegram',
    accountId: 'main',
    peerId: 'peer-1',
    senderId: 'sender-1',
    data: 'decision:ABC123:approve',
    callbackQueryId: 'cb-1',
    ...overrides,
  };
}

function makeMessage(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    channel: 'whatsapp',
    accountId: 'main',
    chatType: 'dm',
    peerId: 'peer-1',
    senderId: 'sender-1',
    text: '1',
    messageId: 'msg-1',
    mentionedBot: false,
    raw: {},
    ...overrides,
  };
}
