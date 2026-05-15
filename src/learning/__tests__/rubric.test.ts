import { describe, expect, it } from 'vitest';
import { buildRubricLearningReviewPrompt } from '../rubric.js';
import { LearningReviewerProtocolError, parseLearningReviewOutput } from '../reviewer.js';

describe('learning rubric protocol', () => {
  it('builds a review prompt with explicit rubric dimensions and strict JSON contract', () => {
    const prompt = buildRubricLearningReviewPrompt({
      agentId: 'agent-a',
      safetyProfile: 'private',
      mode: 'propose',
      triggers: ['user_correction'],
      coalescedCount: 1,
      metadata: { userText: 'Use shorter summaries.', channel: 'telegram' },
      manifest: {
        promptContext: 'artifact body',
        files: [],
        snippets: [],
        omitted: [],
      },
      maxActions: 3,
      maxInputChars: 20_000,
    });

    expect(prompt).toContain('evidenceStrength');
    expect(prompt).toContain('durability');
    expect(prompt).toContain('reusability');
    expect(prompt).toContain('safety');
    expect(prompt).toContain('recommendedActionClass');
    expect(prompt).toContain('baseContentHash');
    expect(prompt).toContain('Return ONLY strict JSON');
    expect(prompt).toContain('artifact body');
    // The reviewer schema is .strict() — rubric keys at the top level of
    // an action will be rejected. The prompt must tell the model the
    // rubric object is nested, not flat, and must show a complete
    // example. Without this, gpt-style models inline the rubric and
    // every turn fails parsing (prod bug, 2026-05-15).
    expect(prompt).toContain('"rubric"');
    expect(prompt).toContain('Do NOT place these rubric keys at the top level');
    expect(prompt).toContain('"type":"memory_candidate"');
    expect(prompt).toContain('"rubric":{"evidenceStrength"');
  });

  it('parses reviewer actions with rubric metadata and remains compatible without it', () => {
    const withRubric = parseLearningReviewOutput(JSON.stringify({
      actions: [{
        type: 'memory_candidate',
        title: 'Remember summary preference',
        rubric: {
          evidenceStrength: 'strong',
          durability: 'durable',
          reusability: 'agent_specific',
          safety: 'safe',
          recommendedActionClass: 'memory',
        },
        payload: { text: 'The user prefers short summaries.', kind: 'preference' },
      }],
    }));
    expect(withRubric.actions[0].rubric).toEqual({
      evidenceStrength: 'strong',
      durability: 'durable',
      reusability: 'agent_specific',
      safety: 'safe',
      recommendedActionClass: 'memory',
    });

    const legacy = parseLearningReviewOutput(JSON.stringify({
      actions: [{ type: 'none', payload: {} }],
    }));
    expect(legacy.actions[0].rubric).toBeUndefined();
  });

  it('rejects flat rubric keys at the top level of an action (regression)', () => {
    // This mirrors the prod failure mode: the model returned rubric
    // fields directly on the action object instead of nested under
    // "rubric". The schema is strict and must reject this so we surface
    // the protocol error rather than silently misinterpret the action.
    expect(() => parseLearningReviewOutput(JSON.stringify({
      actions: [{
        type: 'memory_candidate',
        evidenceStrength: 'strong',
        durability: 'durable',
        reusability: 'agent_specific',
        safety: 'safe',
        recommendedActionClass: 'memory',
        payload: { text: 'Use short summaries.' },
      }],
    }))).toThrow(LearningReviewerProtocolError);
  });

  it('rejects invalid or overscoped rubric output', () => {
    expect(() => parseLearningReviewOutput(JSON.stringify({
      actions: [{
        type: 'memory_candidate',
        rubric: {
          evidenceStrength: 'strong',
          durability: 'forever',
          reusability: 'global',
          safety: 'safe',
          recommendedActionClass: 'memory',
        },
        payload: { text: 'Use concise summaries.' },
      }],
    }))).toThrow(LearningReviewerProtocolError);

    expect(() => parseLearningReviewOutput(JSON.stringify({
      actions: [{ type: 'none', payload: {} }],
      shellCommand: 'rm -rf /',
    }))).toThrow(/schema violation/);
  });
});
