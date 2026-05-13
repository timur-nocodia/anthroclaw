import { describe, it, expect } from 'vitest';
import type { ChannelAdapter, ApprovalRequest } from '../types.js';

describe('ChannelAdapter approval API', () => {
  it('TG channel reports supportsApproval = true', async () => {
    const { TelegramChannel } = await import('../telegram.js');
    expect(TelegramChannel.prototype).toHaveProperty('promptForApproval');
    expect((TelegramChannel as any).supportsApproval).toBe(true);
    expect((TelegramChannel as any).capabilities).toMatchObject({
      callbacks: true,
      textReplies: true,
      editMessage: true,
      threads: true,
      reactions: true,
    });
  });

  it('WA channel reports supportsApproval = false', async () => {
    const { WhatsappChannel } = await import('../whatsapp.js');
    expect((WhatsappChannel as any).supportsApproval).toBe(false);
    expect((WhatsappChannel as any).capabilities).toMatchObject({
      callbacks: false,
      textReplies: true,
      editMessage: true,
      deleteMessage: true,
      threads: false,
      reactions: false,
    });
  });
});
