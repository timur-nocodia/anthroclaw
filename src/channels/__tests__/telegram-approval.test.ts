import { describe, it, expect, vi } from 'vitest';
import type { ChannelAdapter, ApprovalRequest } from '../types.js';

describe('ChannelAdapter approval API', () => {
  it('TG channel reports supportsApproval = true', async () => {
    const { TelegramChannel } = await import('../telegram.js');
    expect(TelegramChannel.prototype).toHaveProperty('promptForApproval');
    expect((TelegramChannel as any).supportsApproval).toBe(true);
    expect((TelegramChannel as any).approvalMode).toBe('interactive_buttons');
    expect((TelegramChannel as any).capabilities).toMatchObject({
      callbacks: true,
      textReplies: true,
      editMessage: true,
      threads: true,
      reactions: true,
    });
  });

  it('WA channel reports text-code approval support', async () => {
    const { WhatsappChannel } = await import('../whatsapp.js');
    expect((WhatsappChannel as any).supportsApproval).toBe(true);
    expect((WhatsappChannel as any).approvalMode).toBe('text_code');
    expect((WhatsappChannel as any).capabilities).toMatchObject({
      callbacks: false,
      textReplies: true,
      editMessage: true,
      deleteMessage: true,
      threads: false,
      reactions: false,
    });
  });

  it('WA promptForApproval sends approve/deny text-code instructions', async () => {
    const { WhatsappChannel } = await import('../whatsapp.js');
    const channel = new WhatsappChannel({ accounts: {}, mediaDir: '/tmp/wa-test-media' });
    const sendText = vi.fn(async (_peerId: string, _text: string, _opts?: unknown) => 'msg-1');
    channel.sendText = sendText as typeof channel.sendText;

    await channel.promptForApproval({
      id: 'approval-1',
      toolName: 'send_message',
      argsPreview: '{"peer_id":"123"}',
      peerId: '123@s.whatsapp.net',
      accountId: 'default',
    });

    expect(sendText).toHaveBeenCalledWith(
      '123@s.whatsapp.net',
      expect.stringContaining('/approve approval-1'),
      expect.objectContaining({ accountId: 'default', parseMode: 'plain' }),
    );
    expect(sendText.mock.calls[0][1]).toContain('/deny approval-1');
  });
});
