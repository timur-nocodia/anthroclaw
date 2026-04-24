import { describe, it, expect } from 'vitest';
import { SessionCompressor } from '../../src/session/compressor.js';

describe('SessionCompressor', () => {
  it('should compress when threshold reached', () => {
    const compressor = new SessionCompressor({ enabled: true, thresholdMessages: 10 });
    expect(compressor.shouldCompress(9)).toBe(false);
    expect(compressor.shouldCompress(10)).toBe(true);
    expect(compressor.shouldCompress(15)).toBe(true);
  });

  it('should not compress when disabled', () => {
    const compressor = new SessionCompressor({ enabled: false, thresholdMessages: 5 });
    expect(compressor.shouldCompress(100)).toBe(false);
  });

  it('uses default config', () => {
    const compressor = new SessionCompressor();
    expect(compressor.shouldCompress(29)).toBe(false);
    expect(compressor.shouldCompress(30)).toBe(true);
  });

  it('provides a structured summary prompt', () => {
    const compressor = new SessionCompressor();
    const prompt = compressor.summaryPrompt;
    expect(prompt).toContain('KEY DECISIONS');
    expect(prompt).toContain('PENDING');
    expect(prompt).toContain('IMPORTANT FACTS');
    expect(prompt).toContain('REMAINING WORK');
    expect(prompt).toContain('memory_write');
  });

  describe('getPressureLevel', () => {
    it('returns green below 50%', () => {
      const c = new SessionCompressor({ enabled: true, thresholdMessages: 100 });
      expect(c.getPressureLevel(0)).toBe('green');
      expect(c.getPressureLevel(49)).toBe('green');
    });

    it('returns yellow at 50%', () => {
      const c = new SessionCompressor({ enabled: true, thresholdMessages: 100 });
      expect(c.getPressureLevel(50)).toBe('yellow');
      expect(c.getPressureLevel(79)).toBe('yellow');
    });

    it('returns orange at 80%', () => {
      const c = new SessionCompressor({ enabled: true, thresholdMessages: 100 });
      expect(c.getPressureLevel(80)).toBe('orange');
      expect(c.getPressureLevel(94)).toBe('orange');
    });

    it('returns red at 95%', () => {
      const c = new SessionCompressor({ enabled: true, thresholdMessages: 100 });
      expect(c.getPressureLevel(95)).toBe('red');
      expect(c.getPressureLevel(100)).toBe('red');
    });

    it('returns green when disabled regardless of count', () => {
      const c = new SessionCompressor({ enabled: false, thresholdMessages: 10 });
      expect(c.getPressureLevel(100)).toBe('green');
    });
  });

  describe('getPressureWarning', () => {
    it('returns null for green level', () => {
      const c = new SessionCompressor({ enabled: true, thresholdMessages: 100 });
      expect(c.getPressureWarning(30)).toBeNull();
    });

    it('returns null for yellow level', () => {
      const c = new SessionCompressor({ enabled: true, thresholdMessages: 100 });
      expect(c.getPressureWarning(50)).toBeNull();
    });

    it('returns orange warning at 80%', () => {
      const c = new SessionCompressor({ enabled: true, thresholdMessages: 100 });
      expect(c.getPressureWarning(80)).toBe('🟠 Context 80% full — consider wrapping up');
    });

    it('returns red warning at 95%', () => {
      const c = new SessionCompressor({ enabled: true, thresholdMessages: 100 });
      expect(c.getPressureWarning(95)).toBe('🔴 Context 95% full — compression imminent');
    });

    it('returns red warning at 100%', () => {
      const c = new SessionCompressor({ enabled: true, thresholdMessages: 100 });
      expect(c.getPressureWarning(100)).toBe('🔴 Context 100% full — compression imminent');
    });

    it('returns null when disabled', () => {
      const c = new SessionCompressor({ enabled: false, thresholdMessages: 10 });
      expect(c.getPressureWarning(100)).toBeNull();
    });
  });
});
