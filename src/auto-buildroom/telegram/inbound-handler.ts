import type { InboundMessage } from '../../channels/types.js';
import type { BuildroomConfig } from '../config/model.js';
import {
  handleTelegramBuildroomCommand,
  type TelegramBuildroomCommandHandlerOptions,
  type TelegramBuildroomCommandHandlerResult,
} from './command-handler.js';
import { telegramBuildroomInputFromInboundMessage } from './inbound.js';

export async function handleTelegramBuildroomInboundMessage(
  config: BuildroomConfig,
  msg: InboundMessage,
  opts: TelegramBuildroomCommandHandlerOptions,
): Promise<TelegramBuildroomCommandHandlerResult> {
  const input = telegramBuildroomInputFromInboundMessage(msg);
  if (!input) return { handled: false };
  return handleTelegramBuildroomCommand(config, input, opts);
}
