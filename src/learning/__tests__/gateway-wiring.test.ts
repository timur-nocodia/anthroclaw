import { describe, expect, it, vi } from 'vitest';
import { Gateway } from '../../gateway.js';
import type { InboundMessage } from '../../channels/types.js';

describe('Gateway learning wiring', () => {
  it('enqueues learning review jobs from post-response metadata when triggers match', () => {
    const gateway = new Gateway() as any;
    const enqueueAfterResponse = vi.fn(() => ({ status: 'started', job: { id: 'job-1' } }));
    gateway.sdkReady = true;
    gateway.learningQueue = { enqueueAfterResponse };

    gateway.enqueueLearningReviewAfterResponse({
      agent: makeAgent(),
      msg: makeMessage({
        text: 'Я говорил тебе: всегда отмечай прогресс в чек-листе.',
        raw: {
          agentRunId: 'run-1',
          agentSdkSessionId: 'sdk-1',
          agentToolCalls: 9,
          agentRecoveredToolErrors: 1,
          agentSkillOrMemoryActivity: true,
        },
      }),
      response: 'Понял, обновил чек-лист.',
      sessionKey: 'telegram:dm:peer-1',
      compressionOrLcmActivity: true,
    });

    expect(enqueueAfterResponse).toHaveBeenCalledOnce();
    expect(enqueueAfterResponse).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'agent-a',
      sessionKey: 'telegram:dm:peer-1',
      runId: 'run-1',
      sdkSessionId: 'sdk-1',
      trigger: 'user_correction',
      triggers: expect.arrayContaining([
        'user_correction',
        'tool_error_recovered',
        'tool_call_threshold',
        'skill_or_memory_activity',
        'compression_or_lcm',
      ]),
      metadata: expect.objectContaining({
        userText: 'Я говорил тебе: всегда отмечай прогресс в чек-листе.',
        assistantText: 'Понял, обновил чек-лист.',
        channel: 'telegram',
        toolCalls: 9,
        recoveredToolErrors: 1,
        skillOrMemoryActivity: true,
        compressionOrLcmActivity: true,
      }),
    }));
  });

  it('does not enqueue when learning is disabled, SDK is unavailable, or there are no triggers', () => {
    const gateway = new Gateway() as any;
    const enqueueAfterResponse = vi.fn(() => ({ status: 'started', job: { id: 'job-1' } }));
    gateway.sdkReady = true;
    gateway.learningQueue = { enqueueAfterResponse };

    gateway.enqueueLearningReviewAfterResponse({
      agent: makeAgent({ enabled: false }),
      msg: makeMessage({ text: 'ordinary message' }),
      response: 'ordinary response',
      sessionKey: 's1',
      compressionOrLcmActivity: false,
    });

    gateway.sdkReady = false;
    gateway.enqueueLearningReviewAfterResponse({
      agent: makeAgent(),
      msg: makeMessage({ text: 'запомни это' }),
      response: 'ok',
      sessionKey: 's1',
      compressionOrLcmActivity: false,
    });

    gateway.sdkReady = true;
    gateway.enqueueLearningReviewAfterResponse({
      agent: makeAgent({ turnCount: 3 }),
      msg: makeMessage({ text: 'ordinary message' }),
      response: 'ordinary response',
      sessionKey: 's1',
      compressionOrLcmActivity: false,
    });

    expect(enqueueAfterResponse).not.toHaveBeenCalled();
  });
});

function makeAgent(overrides: { enabled?: boolean; mode?: 'off' | 'propose' | 'auto_private'; turnCount?: number } = {}) {
  return {
    id: 'agent-a',
    config: {
      learning: {
        enabled: overrides.enabled ?? true,
        mode: overrides.mode ?? 'propose',
        review_interval_turns: 10,
        skill_review_min_tool_calls: 8,
      },
    },
    getMessageCount: () => overrides.turnCount ?? 5,
  };
}

function makeMessage(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    channel: 'telegram',
    accountId: 'default',
    chatType: 'dm',
    peerId: 'peer-1',
    senderId: 'sender-1',
    text: 'hello',
    messageId: 'msg-1',
    mentionedBot: false,
    raw: {},
    ...overrides,
  };
}
