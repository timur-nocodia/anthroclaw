import { describe, it, expect, vi } from 'vitest';
import { createSendMessageTool } from '../../../src/agent/tools/send-message.js';
import type { ChannelAdapter } from '../../../src/channels/types.js';

function makeAdapter(overrides: Partial<ChannelAdapter> = {}): ChannelAdapter {
  return {
    id: 'telegram',
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    onMessage: vi.fn(),
    sendText: vi.fn(async () => 'msg-123'),
    sendMedia: vi.fn(async () => 'media-123'),
    sendTyping: vi.fn(async () => {}),
    ...overrides,
  } as unknown as ChannelAdapter;
}

describe('createSendMessageTool', () => {
  it('has correct name and description', () => {
    const tool = createSendMessageTool(() => undefined);
    expect(tool.name).toBe('send_message');
    expect(tool.description).toBeTruthy();
    expect(tool.description.length).toBeGreaterThan(0);
  });

  it('returns message ID on success', async () => {
    const adapter = makeAdapter({
      sendText: vi.fn(async () => 'msg-456'),
    });
    const getChannel = vi.fn((id: string) =>
      id === 'telegram' ? adapter : undefined,
    );

    const tool = createSendMessageTool(getChannel);
    const response = await tool.handler({
      channel: 'telegram',
      peer_id: 'user-1',
      text: 'Hello!',
    });

    expect(response.isError).toBeUndefined();
    expect(response.content[0].text).toContain('msg-456');
    expect(adapter.sendText).toHaveBeenCalledWith('user-1', 'Hello!', {});
  });

  it('passes account_id in options', async () => {
    const adapter = makeAdapter();
    const getChannel = vi.fn(() => adapter);

    const tool = createSendMessageTool(getChannel);
    await tool.handler({
      channel: 'telegram',
      peer_id: 'user-1',
      text: 'Hi',
      account_id: 'acc-1',
    });

    expect(adapter.sendText).toHaveBeenCalledWith('user-1', 'Hi', {
      accountId: 'acc-1',
    });
  });

  it('returns isError when channel not found', async () => {
    const getChannel = vi.fn(() => undefined);

    const tool = createSendMessageTool(getChannel);
    const response = await tool.handler({
      channel: 'whatsapp',
      peer_id: 'user-1',
      text: 'Hello',
    });

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain('Channel not found');
  });

  it('returns isError when send fails', async () => {
    const adapter = makeAdapter({
      sendText: vi.fn(async () => {
        throw new Error('Network error');
      }),
    });
    const getChannel = vi.fn(() => adapter);

    const tool = createSendMessageTool(getChannel);
    const response = await tool.handler({
      channel: 'telegram',
      peer_id: 'user-1',
      text: 'Hello',
    });

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain('Network error');
  });
});
