import { describe, it, expect } from 'vitest';
import { resolveDisplayConfig } from '../../src/channels/display-config.js';
import type { DisplayConfig } from '../../src/channels/display-config.js';

describe('resolveDisplayConfig', () => {
  it('returns Telegram defaults (toolProgress off — opt-in only)', () => {
    const cfg = resolveDisplayConfig('telegram');
    expect(cfg).toEqual({
      toolProgress: 'off',
      streaming: true,
      toolPreviewLength: 40,
      showReasoning: false,
    });
  });

  it('returns WhatsApp defaults', () => {
    const cfg = resolveDisplayConfig('whatsapp');
    expect(cfg).toEqual({
      toolProgress: 'off',
      streaming: false,
      toolPreviewLength: 0,
      showReasoning: false,
    });
  });

  it('returns global defaults for unknown platform', () => {
    const cfg = resolveDisplayConfig('discord');
    expect(cfg).toEqual({
      toolProgress: 'off',
      streaming: false,
      toolPreviewLength: 0,
      showReasoning: false,
    });
  });

  it('overrides take precedence over platform defaults', () => {
    const cfg = resolveDisplayConfig('telegram', {
      streaming: false,
      showReasoning: true,
      toolProgress: 'all',
    });
    expect(cfg.streaming).toBe(false);
    expect(cfg.showReasoning).toBe(true);
    // Override beats platform default ('off' → 'all').
    expect(cfg.toolProgress).toBe('all');
    // Non-overridden fields keep platform defaults.
    expect(cfg.toolPreviewLength).toBe(40);
  });

  it('partial overrides merge correctly with platform defaults', () => {
    const cfg = resolveDisplayConfig('whatsapp', {
      toolProgress: 'new',
    });
    expect(cfg).toEqual({
      toolProgress: 'new',
      streaming: false,
      toolPreviewLength: 0,
      showReasoning: false,
    });
  });

  it('overrides merge correctly with global defaults for unknown platform', () => {
    const cfg = resolveDisplayConfig('slack', {
      streaming: true,
      toolPreviewLength: 100,
    });
    expect(cfg).toEqual({
      toolProgress: 'off',
      streaming: true,
      toolPreviewLength: 100,
      showReasoning: false,
    });
  });
});
