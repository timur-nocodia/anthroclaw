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
    (gateway as any).decisionCenter = new DecisionCenter({ store });
    (gateway as any).learningStore = learningStore;
    (gateway as any).agents = new Map([
      ['agent-a', {
        id: 'agent-a',
        memoryStore,
        config: {
          safety_profile: 'private',
          learning: { mode: 'propose' },
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
