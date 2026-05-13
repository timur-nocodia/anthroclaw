import { describe, it, expect } from 'vitest';
import { resolveDisplayConfig } from '../display-config.js';

describe('resolveDisplayConfig — toolProgress defaults by safety profile', () => {
  it('returns "off" for public profile on any platform', () => {
    expect(resolveDisplayConfig('telegram', 'public').toolProgress).toBe('off');
    expect(resolveDisplayConfig('whatsapp', 'public').toolProgress).toBe('off');
  });

  it('returns "new" for trusted profile on any platform', () => {
    expect(resolveDisplayConfig('telegram', 'trusted').toolProgress).toBe('new');
    expect(resolveDisplayConfig('whatsapp', 'trusted').toolProgress).toBe('new');
  });

  it('returns "new" for private and chat_like_openclaw profiles', () => {
    expect(resolveDisplayConfig('telegram', 'private').toolProgress).toBe('new');
    expect(resolveDisplayConfig('telegram', 'chat_like_openclaw').toolProgress).toBe('new');
  });
});

describe('resolveDisplayConfig — override layering', () => {
  it('agent override beats safety-profile default', () => {
    expect(resolveDisplayConfig('telegram', 'public', { toolProgress: 'all' }).toolProgress)
      .toBe('all');
    expect(resolveDisplayConfig('telegram', 'trusted', { toolProgress: 'off' }).toolProgress)
      .toBe('off');
  });

  it('global default beats safety-profile default, loses to agent override', () => {
    expect(resolveDisplayConfig('telegram', 'trusted', undefined, { toolProgress: 'all' }).toolProgress)
      .toBe('all');
    expect(resolveDisplayConfig('telegram', 'trusted', { toolProgress: 'off' }, { toolProgress: 'all' }).toolProgress)
      .toBe('off');
  });
});

describe('resolveDisplayConfig — new fields', () => {
  it('cleanupProgress defaults to false', () => {
    expect(resolveDisplayConfig('telegram', 'trusted').cleanupProgress).toBe(false);
  });

  it('cleanupProgress override works', () => {
    expect(resolveDisplayConfig('telegram', 'trusted', { cleanupProgress: true }).cleanupProgress)
      .toBe(true);
  });

  it('subagentTools defaults to "parent"', () => {
    expect(resolveDisplayConfig('telegram', 'trusted').subagentTools).toBe('parent');
  });

  it('subagentTools override works', () => {
    expect(resolveDisplayConfig('telegram', 'trusted', { subagentTools: 'all' }).subagentTools)
      .toBe('all');
  });

  it('toolPreviewLength defaults to 40 for telegram, 0 for whatsapp', () => {
    expect(resolveDisplayConfig('telegram', 'trusted').toolPreviewLength).toBe(40);
    expect(resolveDisplayConfig('whatsapp', 'trusted').toolPreviewLength).toBe(0);
  });

  it('toolEmojis are passed through from override', () => {
    const out = resolveDisplayConfig('telegram', 'trusted', { toolEmojis: { Bash: '🚀' } });
    expect(out.toolEmojis).toEqual({ Bash: '🚀' });
  });
});
