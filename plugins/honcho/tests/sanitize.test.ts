import { describe, expect, it } from 'vitest';
import { sanitizeMessageText } from '../src/sanitize.js';
import { resolveConfig } from '../src/config.js';

describe('Honcho message sanitization', () => {
  it('strips prompt context blocks and tool-progress lines before ingest', () => {
    const clean = sanitizeMessageText(
      [
        '<memory-context>',
        'private recalled context',
        '</memory-context>',
        '<honcho-context-abcd>',
        'derived context',
        '</honcho-context-abcd>',
        '▶ memory_search: customer secret',
        '[User]: keep this sentence',
      ].join('\n'),
      resolveConfig(),
    );

    expect(clean).toBe('[User]: keep this sentence');
  });

  it('redacts common secret patterns', () => {
    const clean = sanitizeMessageText(
      'token=abcdefghijklmnopqrstuvwxyz1234567890 and answer normally',
      resolveConfig(),
    );

    expect(clean).not.toContain('abcdefghijklmnopqrstuvwxyz1234567890');
    expect(clean).toContain('abcdef****7890');
  });

  it('caps oversized messages at the configured character limit', () => {
    const clean = sanitizeMessageText(
      'x'.repeat(1000),
      resolveConfig({}, { observe: { max_message_chars: 640 } }),
    );

    expect(clean.length).toBeLessThanOrEqual(640);
    expect(clean).toContain('[truncated]');
  });

  it('can preserve context-looking text when stripping is disabled', () => {
    const clean = sanitizeMessageText(
      '<memory-context>\nkeep if operator requested\n</memory-context>',
      resolveConfig({}, { privacy: { strip_prompt_context_blocks: false } }),
    );

    expect(clean).toContain('keep if operator requested');
  });
});
