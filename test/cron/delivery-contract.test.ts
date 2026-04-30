import { describe, expect, it } from 'vitest';
import { formatCronDeliveryContract } from '../../src/cron/delivery-contract.js';

describe('formatCronDeliveryContract', () => {
  it('tells cron agents to return text and let runtime deliver it', () => {
    const text = formatCronDeliveryContract({
      channel: 'telegram',
      accountId: 'content_sm',
      peerId: '48705953',
    });

    expect(text).toContain('<cron-delivery-contract>');
    expect(text).toContain('channel=telegram');
    expect(text).toContain('account_id=content_sm');
    expect(text).toContain('peer_id=48705953');
    expect(text).toContain('AnthroClaw will deliver your final assistant response');
    expect(text).toContain('Do not call send_message or send_media');
    expect(text).toContain('Return only the message text');
    expect(text).toContain('[SILENT]');
  });

  it('includes thread target when present', () => {
    const text = formatCronDeliveryContract({
      channel: 'telegram',
      peerId: 'chat-1',
      threadId: 'topic-2',
    });

    expect(text).toContain('thread_id=topic-2');
  });
});
