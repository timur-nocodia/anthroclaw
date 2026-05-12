import type { InboundMessage, SendOptions } from '../../channels/types.js';
import type { BuildroomConfig } from '../config/model.js';
import {
  handleTelegramBuildroomCommand,
  type TelegramBuildroomCommandHandlerOptions,
} from './command-handler.js';
import { telegramBuildroomInputFromInboundMessage } from './inbound.js';

export interface TelegramBuildroomGatewayMessageOptions extends TelegramBuildroomCommandHandlerOptions {
  loadConfig: () => Promise<BuildroomConfig | null>;
  sendText: (peerId: string, text: string, opts?: SendOptions) => Promise<void>;
}

export async function handleTelegramBuildroomGatewayMessage(
  msg: InboundMessage,
  opts: TelegramBuildroomGatewayMessageOptions,
): Promise<boolean> {
  if (!isBuildroomSlashText(msg.text)) return false;

  const input = telegramBuildroomInputFromInboundMessage(msg);
  if (!input) {
    await sendBuildroomGatewayText(msg, opts, 'Buildroom command rejected: malformed Telegram identity.');
    return true;
  }

  const config = await opts.loadConfig();
  if (!config) {
    await sendBuildroomGatewayText(msg, opts, 'Buildroom command rejected: Buildroom config is not initialized.');
    return true;
  }

  const result = await handleTelegramBuildroomCommand(config, input, opts);
  if (!result.handled) return false;
  if (result.ok) {
    for (const message of result.messages) {
      await sendBuildroomGatewayText(msg, opts, message);
    }
  } else {
    await sendBuildroomGatewayText(msg, opts, result.text);
  }
  return true;
}

function isBuildroomSlashText(text: string): boolean {
  return /^\/buildroom(?:@\S+)?(?:\s|$)/.test(text.trim());
}

function sendBuildroomGatewayText(
  msg: InboundMessage,
  opts: TelegramBuildroomGatewayMessageOptions,
  text: string,
): Promise<void> {
  return opts.sendText(msg.peerId, text, {
    accountId: msg.accountId,
    ...(msg.threadId ? { threadId: msg.threadId } : {}),
  });
}
