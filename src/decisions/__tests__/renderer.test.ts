import { describe, expect, it } from 'vitest';
import { renderDecisionPrompt } from '../renderer.js';
import type { DecisionRecord } from '../types.js';

describe('renderDecisionPrompt', () => {
  it('renders callback buttons when the channel supports callbacks', () => {
    const rendered = renderDecisionPrompt(makeDecision(), { callbacks: true });

    expect(rendered.text).toContain('ABC123');
    expect(rendered.text).toContain('Remember preference');
    expect(rendered.buttons).toEqual([
      [
        { text: 'Save', callbackData: 'decision:ABC123:approve' },
        { text: 'Skip', callbackData: 'decision:ABC123:reject' },
        { text: 'Edit', callbackData: 'decision:ABC123:edit' },
      ],
    ]);
  });

  it('renders command and numbered fallback when callbacks are unavailable', () => {
    const rendered = renderDecisionPrompt(makeDecision(), { callbacks: false });

    expect(rendered.buttons).toBeUndefined();
    expect(rendered.text).toContain('Reply 1 to save');
    expect(rendered.text).toContain('/learn approve ABC123');
    expect(rendered.text).toContain('/learn reject ABC123');
    expect(rendered.text).toContain('/learn edit ABC123');
  });
});

function makeDecision(): DecisionRecord {
  return {
    id: 'decision-1',
    shortCode: 'ABC123',
    kind: 'learning_memory',
    scope: 'user',
    actor: 'originating_user',
    status: 'pending',
    agentId: 'agent-a',
    subject: 'Remember preference',
    body: 'Save that the user prefers Russian replies.',
    risk: 'low',
    payload: { text: 'Use Russian replies.' },
    originChannel: 'telegram',
    originAccountId: 'main',
    originPeerId: 'peer-1',
    originSenderId: 'sender-1',
    delivery: [],
    createdAt: 1000,
    updatedAt: 1000,
  };
}
