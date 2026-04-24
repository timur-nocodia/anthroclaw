import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StreamConsumer } from '../../src/channels/stream-consumer.js';

describe('StreamConsumer', () => {
  let sendFn: ReturnType<typeof vi.fn>;
  let editFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    sendFn = vi.fn().mockResolvedValue('msg-1');
    editFn = vi.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('first delta sends initial message', async () => {
    const consumer = new StreamConsumer(sendFn, editFn);
    consumer.onDelta('Hello');

    // Allow the send promise to resolve
    await vi.runAllTimersAsync();

    expect(sendFn).toHaveBeenCalledTimes(1);
    expect(sendFn).toHaveBeenCalledWith('Hello \u2589');
  });

  it('accumulates buffer correctly', () => {
    const consumer = new StreamConsumer(sendFn, editFn);
    consumer.onDelta('Hello ');
    consumer.onDelta('world');

    expect(consumer.fullText).toBe('Hello world');
  });

  it('edits message after interval and threshold', async () => {
    const consumer = new StreamConsumer(sendFn, editFn, {
      editIntervalMs: 500,
      bufferThreshold: 5,
    });

    consumer.onDelta('Hello');
    await vi.runAllTimersAsync();

    // Advance past interval
    vi.advanceTimersByTime(600);

    // Add more text to trigger edit
    consumer.onDelta(' world, how are you doing today?');
    await vi.runAllTimersAsync();

    expect(editFn).toHaveBeenCalled();
    const lastCall = editFn.mock.calls[editFn.mock.calls.length - 1];
    expect(lastCall[0]).toBe('msg-1');
    expect(lastCall[1]).toContain('Hello world, how are you doing today?');
    expect(lastCall[1]).toContain('\u2589');
  });

  it('handles flood control - increments strikes and doubles interval', async () => {
    editFn.mockRejectedValue(new Error('Too Many Requests'));
    const consumer = new StreamConsumer(sendFn, editFn, {
      editIntervalMs: 100,
      bufferThreshold: 1,
      maxFloodStrikes: 3,
    });

    // First delta: send
    consumer.onDelta('Hello');
    await vi.runAllTimersAsync();

    // Trigger edits that fail
    vi.advanceTimersByTime(200);
    consumer.onDelta(' a');
    await vi.runAllTimersAsync();

    vi.advanceTimersByTime(200);
    consumer.onDelta(' b');
    await vi.runAllTimersAsync();

    vi.advanceTimersByTime(400);
    consumer.onDelta(' c');
    await vi.runAllTimersAsync();

    // After 3 strikes, consumer should be disabled
    expect(consumer.isDisabled).toBe(true);
  });

  it('disabled consumer accumulates but does not edit', async () => {
    editFn.mockRejectedValue(new Error('flood'));
    const consumer = new StreamConsumer(sendFn, editFn, {
      editIntervalMs: 100,
      bufferThreshold: 1,
      maxFloodStrikes: 1,
    });

    // Send initial
    consumer.onDelta('Hello');
    await vi.runAllTimersAsync();

    // Trigger a failing edit to disable
    vi.advanceTimersByTime(200);
    consumer.onDelta(' world');
    await vi.runAllTimersAsync();

    expect(consumer.isDisabled).toBe(true);

    // Reset mock to track further calls
    editFn.mockClear();

    // More deltas should accumulate but not trigger edits
    vi.advanceTimersByTime(500);
    consumer.onDelta(' more text');
    await vi.runAllTimersAsync();

    expect(editFn).not.toHaveBeenCalled();
    expect(consumer.fullText).toBe('Hello world more text');
  });

  it('flush sends final text without cursor', async () => {
    const consumer = new StreamConsumer(sendFn, editFn);
    consumer.onDelta('Final answer here');
    await vi.runAllTimersAsync();

    await consumer.flush();

    // Last edit call should not contain cursor
    const lastEditCall = editFn.mock.calls[editFn.mock.calls.length - 1];
    expect(lastEditCall[1]).toBe('Final answer here');
    expect(lastEditCall[1]).not.toContain('\u2589');
  });

  it('flush sends new message when disabled', async () => {
    editFn.mockRejectedValue(new Error('flood'));
    const consumer = new StreamConsumer(sendFn, editFn, {
      editIntervalMs: 100,
      bufferThreshold: 1,
      maxFloodStrikes: 1,
    });

    consumer.onDelta('Hello');
    await vi.runAllTimersAsync();

    // Trigger disable
    vi.advanceTimersByTime(200);
    consumer.onDelta(' world');
    await vi.runAllTimersAsync();

    expect(consumer.isDisabled).toBe(true);
    sendFn.mockClear();

    await consumer.flush();

    expect(sendFn).toHaveBeenCalledWith('Hello world');
  });

  it('strips thinking tags from buffer', () => {
    const consumer = new StreamConsumer(sendFn, editFn);
    consumer.onDelta('Before <think>internal thoughts</think> After');

    expect(consumer.fullText).toBe('Before  After');
  });

  it('strips reasoning tags from buffer', () => {
    const consumer = new StreamConsumer(sendFn, editFn);
    consumer.onDelta('Start <reasoning>step by step logic</reasoning> End');

    expect(consumer.fullText).toBe('Start  End');
  });

  it('strips multiline thinking tags', () => {
    const consumer = new StreamConsumer(sendFn, editFn);
    consumer.onDelta('Hello <think>\nline1\nline2\n</think> World');

    expect(consumer.fullText).toBe('Hello  World');
  });

  it('fullText getter returns accumulated text without thinking tags', () => {
    const consumer = new StreamConsumer(sendFn, editFn);
    consumer.onDelta('Part one ');
    consumer.onDelta('<think>hidden</think>');
    consumer.onDelta('Part two');

    expect(consumer.fullText).toBe('Part one Part two');
  });

  it('truncates display to safe length', async () => {
    const consumer = new StreamConsumer(sendFn, editFn, {
      maxMessageLength: 50,
      cursor: ' X',
    });

    const longText = 'A'.repeat(100);
    consumer.onDelta(longText);
    await vi.runAllTimersAsync();

    // sendFn should have been called with truncated text
    const sentText = sendFn.mock.calls[0][0] as string;
    // Safe length = 50 - 2 (cursor) - 100 = max display is short
    expect(sentText.length).toBeLessThanOrEqual(50);
  });

  it('isDisabled is false initially', () => {
    const consumer = new StreamConsumer(sendFn, editFn);
    expect(consumer.isDisabled).toBe(false);
  });

  it('uses default config values', async () => {
    const consumer = new StreamConsumer(sendFn, editFn);
    consumer.onDelta('test');
    await vi.runAllTimersAsync();

    // First call should include default cursor
    expect(sendFn.mock.calls[0][0]).toContain('\u2589');
  });

  it('flush with no content does nothing', async () => {
    const consumer = new StreamConsumer(sendFn, editFn);
    await consumer.flush();
    expect(sendFn).not.toHaveBeenCalled();
    expect(editFn).not.toHaveBeenCalled();
  });
});
