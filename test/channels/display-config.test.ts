import { describe, it, expect } from 'vitest';
import { resolveDisplayConfig } from '../../src/channels/display-config.js';
import type { DisplayConfig } from '../../src/channels/display-config.js';

describe('resolveDisplayConfig', () => {
  it('returns Telegram defaults (toolProgress off for public profile)', () => {
    const cfg = resolveDisplayConfig('telegram', 'public');
    expect(cfg).toEqual({
      toolProgress: 'off',
      streaming: true,
      toolPreviewLength: 40,
      showReasoning: false,
      cleanupProgress: false,
      subagentTools: 'parent',
      toolEmojis: undefined,
    });
  });

  it('returns WhatsApp defaults', () => {
    const cfg = resolveDisplayConfig('whatsapp', 'public');
    expect(cfg).toEqual({
      toolProgress: 'off',
      streaming: false,
      toolPreviewLength: 0,
      showReasoning: false,
      cleanupProgress: false,
      subagentTools: 'parent',
      toolEmojis: undefined,
    });
  });

  it('returns global defaults for unknown platform', () => {
    const cfg = resolveDisplayConfig('discord', 'public');
    expect(cfg).toEqual({
      toolProgress: 'off',
      streaming: false,
      toolPreviewLength: 0,
      showReasoning: false,
      cleanupProgress: false,
      subagentTools: 'parent',
      toolEmojis: undefined,
    });
  });

  it('overrides take precedence over platform defaults', () => {
    const cfg = resolveDisplayConfig('telegram', 'public', {
      streaming: false,
      showReasoning: true,
      toolProgress: 'all',
    });
    expect(cfg.streaming).toBe(false);
    expect(cfg.showReasoning).toBe(true);
    // Override beats safety-profile default ('off' → 'all').
    expect(cfg.toolProgress).toBe('all');
    // Non-overridden fields keep platform defaults.
    expect(cfg.toolPreviewLength).toBe(40);
  });

  it('partial overrides merge correctly with platform defaults', () => {
    const cfg = resolveDisplayConfig('whatsapp', 'public', {
      toolProgress: 'new',
    });
    expect(cfg).toEqual({
      toolProgress: 'new',
      streaming: false,
      toolPreviewLength: 0,
      showReasoning: false,
      cleanupProgress: false,
      subagentTools: 'parent',
      toolEmojis: undefined,
    });
  });

  it('overrides merge correctly with global defaults for unknown platform', () => {
    const cfg = resolveDisplayConfig('slack', 'public', {
      streaming: true,
      toolPreviewLength: 100,
    });
    expect(cfg).toEqual({
      toolProgress: 'off',
      streaming: true,
      toolPreviewLength: 100,
      showReasoning: false,
      cleanupProgress: false,
      subagentTools: 'parent',
      toolEmojis: undefined,
    });
  });
});
