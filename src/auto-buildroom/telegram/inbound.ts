import type { InboundMessage } from '../../channels/types.js';
import type { TelegramBuildroomCommandInput } from './operator-command.js';

export function telegramBuildroomInputFromInboundMessage(
  msg: InboundMessage,
): TelegramBuildroomCommandInput | null {
  if (msg.channel !== 'telegram') return null;
  const telegramUserId = parseTelegramIntegerId(msg.senderId);
  const chatId = parseTelegramIntegerId(msg.peerId);
  if (telegramUserId == null || chatId == null) return null;

  const threadId = parseOptionalTelegramIntegerId(msg.threadId);
  const replyToId = parseOptionalTelegramIntegerId(msg.replyToId);
  return {
    text: msg.text,
    telegramUserId,
    chatId,
    ...(threadId == null ? {} : { messageThreadId: threadId }),
    ...(replyToId == null ? {} : { replyToMessageId: replyToId }),
  };
}

function parseTelegramIntegerId(value: string | undefined): number | null {
  if (!value || !/^-?\d+$/.test(value)) return null;
  return Number(value);
}

function parseOptionalTelegramIntegerId(value: string | undefined): number | null {
  if (!value) return null;
  return parseTelegramIntegerId(value);
}
