import { HEARTBEAT_ACK_TOKEN } from './constants.js';
import type { HeartbeatDeliveryTarget } from './state-store.js';

export function formatHeartbeatDeliveryContract(target?: HeartbeatDeliveryTarget, ackToken = HEARTBEAT_ACK_TOKEN): string {
  const parts = target
    ? [
        `channel=${target.channel}`,
        target.account_id ? `account_id=${target.account_id}` : null,
        `peer_id=${target.peer_id}`,
        target.thread_id ? `thread_id=${target.thread_id}` : null,
      ].filter(Boolean).join(', ')
    : 'none';

  return [
    '<heartbeat-contract>',
    'This turn was triggered by AnthroClaw heartbeat.',
    'Run only the due heartbeat tasks provided in this turn.',
    'Do not invent old tasks from chat history.',
    `If no user-visible update is needed, respond exactly ${ackToken}.`,
    `Configured delivery target: ${parts}.`,
    'AnthroClaw will deliver your final assistant response when delivery is enabled.',
    'Do not call send_message or send_media to deliver this heartbeat response.',
    'Do not ask for peer_id, chat_id, account_id, or recipient details for this heartbeat delivery.',
    '</heartbeat-contract>',
  ].join('\n');
}

export function isHeartbeatAckResponse(response: string | null | undefined, ackToken = HEARTBEAT_ACK_TOKEN): boolean {
  if (!response) return true;
  const trimmed = response.trim();
  if (!trimmed) return true;
  return trimmed === ackToken || trimmed.startsWith(`${ackToken}\n`) || trimmed.startsWith(`${ackToken} `);
}

