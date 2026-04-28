import { describe, it, expect } from 'vitest';
import { estimateTokens, hasNativeTokenizer } from '../src/tokens.js';

describe('estimateTokens', () => {
  it('returns positive number for non-empty string', () => {
    expect(estimateTokens('hello world')).toBeGreaterThan(0);
  });

  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('returns higher count for longer text', () => {
    const short = estimateTokens('hi');
    const long = estimateTokens('this is a much longer piece of text with many more tokens');
    expect(long).toBeGreaterThan(short);
  });

  it('handles CJK text without throwing', () => {
    const result = estimateTokens('你好世界 これはテストです 안녕하세요');
    expect(result).toBeGreaterThan(0);
  });

  it('handles emoji without throwing', () => {
    const result = estimateTokens('hello 👋 world 🌍');
    expect(result).toBeGreaterThan(0);
  });

  it('hasNativeTokenizer returns boolean', () => {
    expect(typeof hasNativeTokenizer()).toBe('boolean');
  });

  it('char-fallback returns ceil(len/4) when tokenizer disabled', () => {
    const fallback = estimateTokens('hello world!', { forceFallback: true });
    expect(fallback).toBe(Math.ceil('hello world!'.length / 4));
  });
});
