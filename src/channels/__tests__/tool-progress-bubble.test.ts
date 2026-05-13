import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ToolProgressBubble, type ToolProgressBubbleDeps } from '../tool-progress-bubble.js';

function makeDeps(overrides?: Partial<ToolProgressBubbleDeps['config']>) {
  const sendFn = vi.fn(async (_text: string) => 'msg-1');
  const editFn = vi.fn(async (_id: string, _text: string) => true);
  const deleteFn = vi.fn(async (_id: string) => {});
  return {
    sendFn,
    editFn,
    deleteFn,
    config: {
      mode: 'new' as const,
      subagentTools: 'parent' as const,
      cleanupProgress: false,
      previewLength: 40,
      ...overrides,
    },
  };
}

describe('ToolProgressBubble — basic flow', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('sends a new bubble on first tool', async () => {
    const deps = makeDeps();
    const b = new ToolProgressBubble(deps);
    b.onToolStart({ toolName: 'Bash', toolInput: { command: 'ls' }, toolUseId: 't1' });
    await vi.runAllTimersAsync();
    expect(deps.sendFn).toHaveBeenCalledTimes(1);
    expect(deps.sendFn.mock.calls[0][0]).toMatch(/💻.*Bash.*ls/);
  });

  it('edits the same bubble on subsequent tool start', async () => {
    const deps = makeDeps();
    const b = new ToolProgressBubble(deps);
    b.onToolStart({ toolName: 'Bash', toolInput: { command: 'ls' }, toolUseId: 't1' });
    await vi.runAllTimersAsync();
    b.onToolStart({ toolName: 'Read', toolInput: { file_path: '/x/y.md' }, toolUseId: 't2' });
    await vi.advanceTimersByTimeAsync(2000);
    expect(deps.sendFn).toHaveBeenCalledTimes(1);
    expect(deps.editFn).toHaveBeenCalled();
    const lastEdit = deps.editFn.mock.calls.at(-1)![1];
    expect(lastEdit).toMatch(/💻.*Bash.*ls/);
    expect(lastEdit).toMatch(/📖.*Read.*y\.md/);
  });
});

describe('ToolProgressBubble — modes', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('mode=off → no send', async () => {
    const deps = makeDeps({ mode: 'off' });
    const b = new ToolProgressBubble(deps);
    b.onToolStart({ toolName: 'Bash', toolInput: { command: 'ls' }, toolUseId: 't1' });
    await vi.runAllTimersAsync();
    expect(deps.sendFn).not.toHaveBeenCalled();
  });

  it('mode=new → repeat tool name in same bubble is dropped', async () => {
    const deps = makeDeps({ mode: 'new' });
    const b = new ToolProgressBubble(deps);
    b.onToolStart({ toolName: 'Bash', toolInput: { command: 'ls' }, toolUseId: 't1' });
    b.onToolStart({ toolName: 'Bash', toolInput: { command: 'pwd' }, toolUseId: 't2' });
    await vi.runAllTimersAsync();
    expect(deps.sendFn).toHaveBeenCalledTimes(1);
    expect(deps.sendFn.mock.calls[0][0]).not.toContain('pwd');
  });

  it('mode=all → every tool call rendered, identical adjacent ones dedup to ×N', async () => {
    const deps = makeDeps({ mode: 'all' });
    const b = new ToolProgressBubble(deps);
    b.onToolStart({ toolName: 'Bash', toolInput: { command: 'ls' }, toolUseId: 't1' });
    await vi.runAllTimersAsync();
    b.onToolStart({ toolName: 'Bash', toolInput: { command: 'ls' }, toolUseId: 't2' });
    b.onToolStart({ toolName: 'Bash', toolInput: { command: 'ls' }, toolUseId: 't3' });
    await vi.advanceTimersByTimeAsync(2000);
    const lastEdit = deps.editFn.mock.calls.at(-1)![1];
    expect(lastEdit).toMatch(/×3/);
  });
});

describe('ToolProgressBubble — throttle', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('batches rapid events into a single edit after the throttle window', async () => {
    const deps = makeDeps({ mode: 'all' });
    const b = new ToolProgressBubble(deps);
    b.onToolStart({ toolName: 'Bash', toolInput: { command: 'a' }, toolUseId: 't1' });
    await vi.runAllTimersAsync();
    b.onToolStart({ toolName: 'Read', toolInput: { file_path: '/b' }, toolUseId: 't2' });
    b.onToolStart({ toolName: 'Grep', toolInput: { pattern: 'c' }, toolUseId: 't3' });
    b.onToolStart({ toolName: 'Write', toolInput: { file_path: '/d' }, toolUseId: 't4' });
    expect(deps.editFn).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(1600);
    expect(deps.editFn).toHaveBeenCalledTimes(1);
  });
});

describe('ToolProgressBubble — content break', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('onContentBreak flushes then resets; next tool opens a new bubble', async () => {
    const deps = makeDeps();
    deps.sendFn.mockResolvedValueOnce('msg-1').mockResolvedValueOnce('msg-2');
    const b = new ToolProgressBubble(deps);
    b.onToolStart({ toolName: 'Bash', toolInput: { command: 'ls' }, toolUseId: 't1' });
    await vi.runAllTimersAsync();
    b.onContentBreak();
    await vi.runAllTimersAsync();
    b.onToolStart({ toolName: 'Read', toolInput: { file_path: '/x' }, toolUseId: 't2' });
    await vi.runAllTimersAsync();
    expect(deps.sendFn).toHaveBeenCalledTimes(2);
  });

  it('after onContentBreak, repeat tool name in new bubble is allowed', async () => {
    const deps = makeDeps({ mode: 'new' });
    deps.sendFn.mockResolvedValueOnce('msg-1').mockResolvedValueOnce('msg-2');
    const b = new ToolProgressBubble(deps);
    b.onToolStart({ toolName: 'Bash', toolInput: { command: 'a' }, toolUseId: 't1' });
    await vi.runAllTimersAsync();
    b.onContentBreak();
    await vi.runAllTimersAsync();
    b.onToolStart({ toolName: 'Bash', toolInput: { command: 'b' }, toolUseId: 't2' });
    await vi.runAllTimersAsync();
    expect(deps.sendFn).toHaveBeenCalledTimes(2);
  });
});

describe('ToolProgressBubble — errors', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('onToolError appends ❌ to the right line', async () => {
    const deps = makeDeps();
    const b = new ToolProgressBubble(deps);
    b.onToolStart({ toolName: 'Bash', toolInput: { command: 'ls' }, toolUseId: 't1' });
    await vi.runAllTimersAsync();
    b.onToolError({ toolUseId: 't1', toolName: 'Bash' });
    await vi.advanceTimersByTimeAsync(2000);
    const lastEdit = deps.editFn.mock.calls.at(-1)![1];
    expect(lastEdit).toMatch(/❌/);
  });

  it('onToolError for unknown toolUseId is a no-op', async () => {
    const deps = makeDeps();
    const b = new ToolProgressBubble(deps);
    b.onToolStart({ toolName: 'Bash', toolInput: { command: 'ls' }, toolUseId: 't1' });
    await vi.runAllTimersAsync();
    deps.editFn.mockClear();
    b.onToolError({ toolUseId: 'missing', toolName: 'Bash' });
    await vi.advanceTimersByTimeAsync(2000);
    expect(deps.editFn).not.toHaveBeenCalled();
  });
});

describe('ToolProgressBubble — cleanup', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('cleanupProgress + success → deletes every breadcrumb', async () => {
    const deps = makeDeps({ cleanupProgress: true });
    deps.sendFn.mockResolvedValueOnce('m1').mockResolvedValueOnce('m2');
    const b = new ToolProgressBubble(deps);
    b.onToolStart({ toolName: 'Bash', toolInput: { command: 'a' }, toolUseId: 't1' });
    await vi.runAllTimersAsync();
    b.onContentBreak();
    b.onToolStart({ toolName: 'Read', toolInput: { file_path: '/x' }, toolUseId: 't2' });
    await vi.runAllTimersAsync();
    await b.finalize(true);
    expect(deps.deleteFn).toHaveBeenCalledTimes(2);
    expect(deps.deleteFn.mock.calls.map(c => c[0])).toEqual(['m1', 'm2']);
  });

  it('cleanupProgress + failure → no deletes (breadcrumb stays)', async () => {
    const deps = makeDeps({ cleanupProgress: true });
    const b = new ToolProgressBubble(deps);
    b.onToolStart({ toolName: 'Bash', toolInput: { command: 'a' }, toolUseId: 't1' });
    await vi.runAllTimersAsync();
    await b.finalize(false);
    expect(deps.deleteFn).not.toHaveBeenCalled();
  });

  it('finalize({silent: true}) → deletes every breadcrumb regardless of cleanupProgress', async () => {
    const deps = makeDeps({ cleanupProgress: false });
    const b = new ToolProgressBubble(deps);
    b.onToolStart({ toolName: 'Bash', toolInput: { command: 'a' }, toolUseId: 't1' });
    await vi.runAllTimersAsync();
    await b.finalize(true, { silent: true });
    expect(deps.deleteFn).toHaveBeenCalledTimes(1);
  });
});

describe('ToolProgressBubble — flood handling', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('disables after 3 consecutive editFn rejections', async () => {
    const deps = makeDeps({ mode: 'all' });
    deps.editFn.mockRejectedValue(new Error('flood'));
    const b = new ToolProgressBubble(deps);
    b.onToolStart({ toolName: 'Bash', toolInput: { command: 'a' }, toolUseId: 't1' });
    await vi.runAllTimersAsync();
    for (let i = 0; i < 5; i++) {
      b.onToolStart({ toolName: 'Read', toolInput: { file_path: `/f${i}` }, toolUseId: `t${i + 2}` });
      await vi.advanceTimersByTimeAsync(2000);
    }
    const editCallsBefore = deps.editFn.mock.calls.length;
    b.onToolStart({ toolName: 'Grep', toolInput: { pattern: 'q' }, toolUseId: 'late' });
    await vi.advanceTimersByTimeAsync(2000);
    expect(deps.editFn.mock.calls.length).toBe(editCallsBefore);
  });
});

describe('ToolProgressBubble — subagents', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('subagentTools=parent → child tool with parentToolUseId is dropped', async () => {
    const deps = makeDeps({ subagentTools: 'parent' });
    const b = new ToolProgressBubble(deps);
    b.onToolStart({ toolName: 'Task', toolInput: { description: 'investigate' }, toolUseId: 'task1' });
    b.onToolStart({ toolName: 'Read', toolInput: { file_path: '/x' }, toolUseId: 'sub1', parentToolUseId: 'task1' });
    await vi.runAllTimersAsync();
    expect(deps.sendFn.mock.calls[0][0]).toMatch(/🎯.*Task.*investigate/);
    expect(deps.sendFn.mock.calls[0][0]).not.toContain('Read');
  });

  it('subagentTools=indented → child tool rendered with two-space prefix', async () => {
    const deps = makeDeps({ subagentTools: 'indented' });
    const b = new ToolProgressBubble(deps);
    b.onToolStart({ toolName: 'Task', toolInput: { description: 'investigate' }, toolUseId: 'task1' });
    await vi.runAllTimersAsync();
    b.onToolStart({ toolName: 'Read', toolInput: { file_path: '/x' }, toolUseId: 'sub1', parentToolUseId: 'task1' });
    await vi.advanceTimersByTimeAsync(2000);
    const lastEdit = deps.editFn.mock.calls.at(-1)![1];
    expect(lastEdit).toMatch(/\n {2}📖.*Read/);
  });
});

describe('ToolProgressBubble — emoji overrides', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('uses override emoji when configured', async () => {
    const deps = makeDeps();
    (deps.config as any).toolEmojiOverrides = { Bash: '🚀' };
    const b = new ToolProgressBubble(deps);
    b.onToolStart({ toolName: 'Bash', toolInput: { command: 'ls' }, toolUseId: 't1' });
    await vi.runAllTimersAsync();
    expect(deps.sendFn.mock.calls[0][0]).toContain('🚀');
  });
});
