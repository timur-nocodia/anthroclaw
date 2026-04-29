import { describe, it, expect } from 'vitest';
import { CHAT_PERSONALITY_BASELINE } from '../chat-personality-baseline.js';

describe('CHAT_PERSONALITY_BASELINE', () => {
  it('is a non-empty string', () => {
    expect(typeof CHAT_PERSONALITY_BASELINE).toBe('string');
    expect(CHAT_PERSONALITY_BASELINE.length).toBeGreaterThan(50);
  });

  it('describes a messaging agent (not CLI helper)', () => {
    expect(CHAT_PERSONALITY_BASELINE.toLowerCase()).toContain('messaging');
    expect(CHAT_PERSONALITY_BASELINE.toLowerCase()).toContain('not a cli');
  });

  it('encourages warm conversational tone', () => {
    expect(CHAT_PERSONALITY_BASELINE.toLowerCase()).toMatch(/warm|conversational|curious/);
  });

  it('is trimmed (no leading/trailing whitespace)', () => {
    expect(CHAT_PERSONALITY_BASELINE).toBe(CHAT_PERSONALITY_BASELINE.trim());
  });
});
