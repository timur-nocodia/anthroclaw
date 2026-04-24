import { describe, it, expect, vi } from 'vitest';
import { createSendMediaTool } from '../../../src/agent/tools/send-media.js';
import type { ChannelAdapter } from '../../../src/channels/types.js';

function makeAdapter(overrides: Partial<ChannelAdapter> = {}): ChannelAdapter {
  return {
    id: 'telegram',
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    onMessage: vi.fn(),
    sendText: vi.fn(async () => 'msg-123'),
    sendMedia: vi.fn(async () => 'media-789'),
    sendTyping: vi.fn(async () => {}),
    ...overrides,
  } as unknown as ChannelAdapter;
}

describe('createSendMediaTool', () => {
  const workspacePath = '/workspace/project';

  it('has correct name and description', () => {
    const tool = createSendMediaTool(workspacePath, () => undefined);
    expect(tool.name).toBe('send_media');
    expect(tool.description).toBeTruthy();
    expect(tool.description.length).toBeGreaterThan(0);
  });

  it('returns message ID on success', async () => {
    const adapter = makeAdapter({
      sendMedia: vi.fn(async () => 'media-456'),
    });
    const getChannel = vi.fn((id: string) =>
      id === 'telegram' ? adapter : undefined,
    );

    const tool = createSendMediaTool(workspacePath, getChannel);
    const response = await tool.handler({
      channel: 'telegram',
      peer_id: 'user-1',
      file_path: 'images/photo.jpg',
      type: 'image',
    });

    expect(response.isError).toBeUndefined();
    expect(response.content[0].text).toContain('media-456');
    expect(adapter.sendMedia).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        type: 'image',
        path: expect.stringContaining('images/photo.jpg'),
        mimeType: 'image/jpeg',
      }),
      {},
    );
  });

  it('includes caption when provided', async () => {
    const adapter = makeAdapter();
    const getChannel = vi.fn(() => adapter);

    const tool = createSendMediaTool(workspacePath, getChannel);
    await tool.handler({
      channel: 'telegram',
      peer_id: 'user-1',
      file_path: 'docs/report.pdf',
      type: 'document',
      caption: 'Monthly report',
    });

    expect(adapter.sendMedia).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        caption: 'Monthly report',
      }),
      {},
    );
  });

  it('blocks path traversal with ../', async () => {
    const adapter = makeAdapter();
    const getChannel = vi.fn(() => adapter);

    const tool = createSendMediaTool(workspacePath, getChannel);
    const response = await tool.handler({
      channel: 'telegram',
      peer_id: 'user-1',
      file_path: '../../../etc/passwd',
      type: 'document',
    });

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain('Path traversal blocked');
    expect(adapter.sendMedia).not.toHaveBeenCalled();
  });

  it('blocks absolute path traversal', async () => {
    const adapter = makeAdapter();
    const getChannel = vi.fn(() => adapter);

    const tool = createSendMediaTool(workspacePath, getChannel);
    const response = await tool.handler({
      channel: 'telegram',
      peer_id: 'user-1',
      file_path: '/etc/passwd',
      type: 'document',
    });

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain('Path traversal blocked');
  });

  it('returns isError when channel not found', async () => {
    const getChannel = vi.fn(() => undefined);

    const tool = createSendMediaTool(workspacePath, getChannel);
    const response = await tool.handler({
      channel: 'whatsapp',
      peer_id: 'user-1',
      file_path: 'photo.jpg',
      type: 'image',
    });

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain('Channel not found');
  });

  it('returns isError when send fails', async () => {
    const adapter = makeAdapter({
      sendMedia: vi.fn(async () => {
        throw new Error('File not found');
      }),
    });
    const getChannel = vi.fn(() => adapter);

    const tool = createSendMediaTool(workspacePath, getChannel);
    const response = await tool.handler({
      channel: 'telegram',
      peer_id: 'user-1',
      file_path: 'missing.jpg',
      type: 'image',
    });

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain('File not found');
  });

  it('passes account_id in options', async () => {
    const adapter = makeAdapter();
    const getChannel = vi.fn(() => adapter);

    const tool = createSendMediaTool(workspacePath, getChannel);
    await tool.handler({
      channel: 'telegram',
      peer_id: 'user-1',
      file_path: 'photo.jpg',
      type: 'image',
      account_id: 'acc-2',
    });

    expect(adapter.sendMedia).toHaveBeenCalledWith(
      'user-1',
      expect.any(Object),
      { accountId: 'acc-2' },
    );
  });
});
