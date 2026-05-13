import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ToolProgressBubble } from '../tool-progress-bubble.js';

/**
 * Simulates the gateway driving a bubble through a full SDK turn:
 *   PreToolUse(Bash) → PreToolUse(Read) → assistant.partial_text → PreToolUse(WebSearch) → result
 */
describe('ToolProgressBubble — integration: full turn', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('produces two distinct bubbles split by content break', async () => {
    const send = vi.fn<(text: string) => Promise<string>>();
    send.mockResolvedValueOnce('bubble-1').mockResolvedValueOnce('bubble-2');
    const edit = vi.fn(async () => true);
    const del = vi.fn(async (_id: string) => {});

    const b = new ToolProgressBubble({
      sendFn: send,
      editFn: edit,
      deleteFn: del,
      config: { mode: 'new', subagentTools: 'parent', cleanupProgress: false, previewLength: 40 },
    });

    b.onToolStart({ toolName: 'Bash', toolInput: { command: 'ls' }, toolUseId: 't1' });
    b.onToolStart({ toolName: 'Read', toolInput: { file_path: '/x/y.md' }, toolUseId: 't2' });
    await vi.runAllTimersAsync();
    b.onContentBreak();
    await vi.runAllTimersAsync();
    b.onToolStart({ toolName: 'WebSearch', toolInput: { query: 'foo' }, toolUseId: 't3' });
    await vi.runAllTimersAsync();
    await b.finalize(true);

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0]).toMatch(/💻.*Bash.*ls[\s\S]*📖.*Read.*y\.md/);
    expect(send.mock.calls[1][0]).toMatch(/🔎.*WebSearch.*foo/);
    expect(del).not.toHaveBeenCalled();
  });

  it('with cleanupProgress=true on success → deletes both bubbles', async () => {
    const send = vi.fn<(text: string) => Promise<string>>()
      .mockResolvedValueOnce('m1').mockResolvedValueOnce('m2');
    const edit = vi.fn(async () => true);
    const del = vi.fn(async (_id: string) => {});
    const b = new ToolProgressBubble({
      sendFn: send,
      editFn: edit,
      deleteFn: del,
      config: { mode: 'new', subagentTools: 'parent', cleanupProgress: true, previewLength: 40 },
    });

    b.onToolStart({ toolName: 'Bash', toolInput: { command: 'a' }, toolUseId: 't1' });
    await vi.runAllTimersAsync();
    b.onContentBreak();
    b.onToolStart({ toolName: 'Read', toolInput: { file_path: '/x' }, toolUseId: 't2' });
    await vi.runAllTimersAsync();
    await b.finalize(true);

    expect(del).toHaveBeenCalledTimes(2);
    expect(del.mock.calls.map(c => c[0])).toEqual(['m1', 'm2']);
  });
});
