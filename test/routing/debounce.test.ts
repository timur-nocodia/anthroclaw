import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MessageDebouncer } from '../../src/routing/debounce.js';
import type { InboundMessage } from '../../src/channels/types.js';

function makeMsg(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    channel: 'telegram',
    accountId: 'default',
    chatType: 'dm',
    peerId: 'peer-1',
    senderId: 'sender-1',
    text: 'hello',
    messageId: 'msg-1',
    mentionedBot: false,
    raw: {},
    ...overrides,
  };
}

describe('MessageDebouncer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('flushes single message after delay', async () => {
    const flush = vi.fn().mockResolvedValue(undefined);
    const debouncer = new MessageDebouncer(flush, { delayMs: 500 });

    debouncer.add(makeMsg({ text: 'hello' }));

    expect(flush).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);

    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush.mock.calls[0][0].text).toBe('hello');

    debouncer.stop();
  });

  it('merges rapid-fire messages into one', async () => {
    const flush = vi.fn().mockResolvedValue(undefined);
    const debouncer = new MessageDebouncer(flush, { delayMs: 500 });

    debouncer.add(makeMsg({ text: 'hi', messageId: 'msg-1' }));

    vi.advanceTimersByTime(200);
    debouncer.add(makeMsg({ text: 'how are you?', messageId: 'msg-2' }));

    vi.advanceTimersByTime(200);
    debouncer.add(makeMsg({ text: 'here is my question', messageId: 'msg-3' }));

    // Not flushed yet
    expect(flush).not.toHaveBeenCalled();

    // Advance past the delay from the last message
    vi.advanceTimersByTime(500);

    expect(flush).toHaveBeenCalledTimes(1);
    const merged = flush.mock.calls[0][0] as InboundMessage;
    expect(merged.text).toBe('hi\nhow are you?\nhere is my question');
    expect(merged.messageId).toBe('msg-3');

    debouncer.stop();
  });

  it('handles messages from different senders independently', async () => {
    const flush = vi.fn().mockResolvedValue(undefined);
    const debouncer = new MessageDebouncer(flush, { delayMs: 500 });

    debouncer.add(makeMsg({ senderId: 'alice', text: 'from alice' }));
    debouncer.add(makeMsg({ senderId: 'bob', text: 'from bob' }));

    vi.advanceTimersByTime(500);

    expect(flush).toHaveBeenCalledTimes(2);

    debouncer.stop();
  });

  it('preserves media from last message', async () => {
    const flush = vi.fn().mockResolvedValue(undefined);
    const debouncer = new MessageDebouncer(flush, { delayMs: 500 });

    debouncer.add(makeMsg({ text: 'check this out' }));
    debouncer.add(makeMsg({
      text: '',
      media: { type: 'image', path: '/tmp/img.jpg', mimeType: 'image/jpeg' },
    }));

    vi.advanceTimersByTime(500);

    const merged = flush.mock.calls[0][0] as InboundMessage;
    expect(merged.media?.type).toBe('image');

    debouncer.stop();
  });

  it('merges mentionedBot from any message', async () => {
    const flush = vi.fn().mockResolvedValue(undefined);
    const debouncer = new MessageDebouncer(flush, { delayMs: 500 });

    debouncer.add(makeMsg({ mentionedBot: false, text: 'hey' }));
    debouncer.add(makeMsg({ mentionedBot: true, text: '@bot help' }));

    vi.advanceTimersByTime(500);

    const merged = flush.mock.calls[0][0] as InboundMessage;
    expect(merged.mentionedBot).toBe(true);

    debouncer.stop();
  });

  it('stop() clears all pending timers', () => {
    const flush = vi.fn().mockResolvedValue(undefined);
    const debouncer = new MessageDebouncer(flush, { delayMs: 500 });

    debouncer.add(makeMsg({ text: 'will not flush' }));
    debouncer.stop();

    vi.advanceTimersByTime(1000);
    expect(flush).not.toHaveBeenCalled();
  });
});
