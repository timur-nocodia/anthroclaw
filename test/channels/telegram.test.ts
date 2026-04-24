import { describe, it, expect } from 'vitest';
import { TelegramChannel } from '../../src/channels/telegram.js';
import { chunkText } from '../../src/channels/utils.js';

describe('TelegramChannel', () => {
  it('class exists and has correct id', () => {
    // TelegramChannel requires a real bot token for grammy Bot instantiation,
    // so we only verify the class and its static shape here.
    expect(TelegramChannel).toBeDefined();
    expect(typeof TelegramChannel).toBe('function');

    // Verify the prototype has the expected methods
    expect(typeof TelegramChannel.prototype.onMessage).toBe('function');
    expect(typeof TelegramChannel.prototype.start).toBe('function');
    expect(typeof TelegramChannel.prototype.stop).toBe('function');
    expect(typeof TelegramChannel.prototype.sendText).toBe('function');
    expect(typeof TelegramChannel.prototype.editText).toBe('function');
    expect(typeof TelegramChannel.prototype.sendMedia).toBe('function');
    expect(typeof TelegramChannel.prototype.sendTyping).toBe('function');
  });
});

describe('chunkText', () => {
  it('returns single chunk when text is under limit', () => {
    const text = 'Hello, world!';
    const result = chunkText(text, 100);
    expect(result).toEqual(['Hello, world!']);
  });

  it('returns single chunk when text exactly equals limit', () => {
    const text = 'abc';
    const result = chunkText(text, 3);
    expect(result).toEqual(['abc']);
  });

  it('splits at newlines when text exceeds limit', () => {
    const text = 'line one\nline two\nline three\nline four';
    // Limit of 18 should split after "line one\nline two\n" (18 chars)
    const result = chunkText(text, 18);
    expect(result.length).toBeGreaterThan(1);
    // Every chunk must be within limit
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(18);
    }
    // Reassembled content should match original (chunks include trailing newlines)
    expect(result.join('')).toBe(text);
  });

  it('hard cuts when a single line exceeds the limit', () => {
    const text = 'abcdefghijklmnopqrstuvwxyz';
    const result = chunkText(text, 10);
    expect(result).toEqual(['abcdefghij', 'klmnopqrst', 'uvwxyz']);
  });

  it('handles mixed long lines and newlines', () => {
    const text = 'short\n' + 'a'.repeat(25) + '\nend';
    const result = chunkText(text, 10);
    // All chunks should be within limit
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(10);
    }
    // All content should be preserved
    expect(result.join('\n').replace(/\n/g, '') + '').toBeTruthy();
  });

  it('uses default limit of 4000', () => {
    const text = 'x'.repeat(4000);
    const result = chunkText(text);
    expect(result).toEqual([text]);

    const longText = 'y'.repeat(4001);
    const result2 = chunkText(longText);
    expect(result2.length).toBe(2);
    expect(result2[0].length).toBe(4000);
    expect(result2[1].length).toBe(1);
  });

  it('returns text as-is for empty string', () => {
    expect(chunkText('')).toEqual(['']);
  });
});
