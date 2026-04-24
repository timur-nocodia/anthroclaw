import { describe, it, expect, vi } from 'vitest';
import { generateSessionTitle } from '../../src/session/title-generator.js';

describe('generateSessionTitle', () => {
  it('generates a normal title', async () => {
    const queryFn = vi.fn().mockResolvedValue('Weather Forecast Discussion');
    const title = await generateSessionTitle(
      'What is the weather today?',
      'The weather is sunny and warm.',
      queryFn,
    );
    expect(title).toBe('Weather Forecast Discussion');
    expect(queryFn).toHaveBeenCalledOnce();
  });

  it('strips double quotes from response', async () => {
    const queryFn = vi.fn().mockResolvedValue('"Budget Planning Help"');
    const title = await generateSessionTitle('Help me plan', 'Sure!', queryFn);
    expect(title).toBe('Budget Planning Help');
  });

  it('strips single quotes from response', async () => {
    const queryFn = vi.fn().mockResolvedValue("'Budget Planning Help'");
    const title = await generateSessionTitle('Help me plan', 'Sure!', queryFn);
    expect(title).toBe('Budget Planning Help');
  });

  it('strips "Title:" prefix (case-insensitive)', async () => {
    const queryFn = vi.fn().mockResolvedValue('Title: My Great Chat');
    const title = await generateSessionTitle('Hi', 'Hello!', queryFn);
    expect(title).toBe('My Great Chat');
  });

  it('strips "title:" lowercase prefix', async () => {
    const queryFn = vi.fn().mockResolvedValue('title: lowercase prefix');
    const title = await generateSessionTitle('Hi', 'Hello!', queryFn);
    expect(title).toBe('lowercase prefix');
  });

  it('strips trailing punctuation (. ! ?)', async () => {
    const queryFn = vi.fn().mockResolvedValue('Some Topic Here!');
    const title = await generateSessionTitle('Hi', 'Hello!', queryFn);
    expect(title).toBe('Some Topic Here');
  });

  it('strips trailing question mark', async () => {
    const queryFn = vi.fn().mockResolvedValue('Some Topic Here?');
    const title = await generateSessionTitle('Hi', 'Hello!', queryFn);
    expect(title).toBe('Some Topic Here');
  });

  it('strips trailing period', async () => {
    const queryFn = vi.fn().mockResolvedValue('Some Topic Here.');
    const title = await generateSessionTitle('Hi', 'Hello!', queryFn);
    expect(title).toBe('Some Topic Here');
  });

  it('cleans multiple artifacts at once', async () => {
    const queryFn = vi.fn().mockResolvedValue('Title: "Debugging Session!"');
    const title = await generateSessionTitle('Fix bug', 'Let me look...', queryFn);
    expect(title).toBe('Debugging Session');
  });

  it('truncates long titles to 80 chars with ellipsis', async () => {
    const longTitle = 'A'.repeat(100);
    const queryFn = vi.fn().mockResolvedValue(longTitle);
    const title = await generateSessionTitle('Hi', 'Hello', queryFn);
    expect(title.length).toBe(80);
    expect(title.endsWith('...')).toBe(true);
    expect(title).toBe('A'.repeat(77) + '...');
  });

  it('returns "Untitled Session" for empty response', async () => {
    const queryFn = vi.fn().mockResolvedValue('');
    const title = await generateSessionTitle('Hi', 'Hello', queryFn);
    expect(title).toBe('Untitled Session');
  });

  it('returns "Untitled Session" for whitespace-only response', async () => {
    const queryFn = vi.fn().mockResolvedValue('   \n\t  ');
    const title = await generateSessionTitle('Hi', 'Hello', queryFn);
    expect(title).toBe('Untitled Session');
  });

  it('returns "Untitled Session" when queryFn throws', async () => {
    const queryFn = vi.fn().mockRejectedValue(new Error('API error'));
    const title = await generateSessionTitle('Hi', 'Hello', queryFn);
    expect(title).toBe('Untitled Session');
  });

  it('truncates long inputs to 500 chars', async () => {
    const longInput = 'x'.repeat(1000);
    const queryFn = vi.fn().mockResolvedValue('Short Title');
    await generateSessionTitle(longInput, longInput, queryFn);

    const prompt = queryFn.mock.calls[0][0] as string;
    // Each input should be truncated to 500 chars, so the total
    // prompt should not contain 1000 consecutive x's
    expect(prompt).not.toContain('x'.repeat(501));
    // But it should contain exactly 500
    expect(prompt).toContain('x'.repeat(500));
  });

  it('returns "Untitled Session" when response is only quotes', async () => {
    const queryFn = vi.fn().mockResolvedValue('""');
    const title = await generateSessionTitle('Hi', 'Hello', queryFn);
    expect(title).toBe('Untitled Session');
  });
});
