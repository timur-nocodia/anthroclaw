export interface CronDeliveryTarget {
  channel: string;
  accountId?: string;
  peerId: string;
  threadId?: string;
}

export function formatCronDeliveryContract(target: CronDeliveryTarget): string {
  const parts = [
    `channel=${target.channel}`,
    target.accountId ? `account_id=${target.accountId}` : null,
    `peer_id=${target.peerId}`,
    target.threadId ? `thread_id=${target.threadId}` : null,
  ].filter(Boolean).join(', ');

  return [
    '<cron-delivery-contract>',
    'This turn was triggered by an AnthroClaw cron job.',
    `Configured delivery target: ${parts}.`,
    'AnthroClaw will deliver your final assistant response to that target after this turn.',
    'Do not call send_message or send_media to deliver this cron response, even if the cron prompt says "send", "отправь", or "напомни".',
    'Do not ask for peer_id, chat_id, account_id, or recipient details for this cron delivery.',
    'Return only the message text that should be delivered. If no message should be delivered, respond exactly [SILENT].',
    '</cron-delivery-contract>',
  ].join('\n');
}
