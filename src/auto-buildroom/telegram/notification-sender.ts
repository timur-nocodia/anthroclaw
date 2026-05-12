import { formatTelegramBuildroomMessages } from './command-handler.js';
import {
  resolveTelegramBuildroomNotificationTargets,
  type TelegramBuildroomNotificationTarget,
} from './notification.js';

export interface SendTelegramBuildroomNotificationOptions {
  routes: string[];
  text: string;
  sendText: (target: TelegramBuildroomNotificationTarget, text: string) => Promise<void>;
}

export async function sendTelegramBuildroomNotification(
  opts: SendTelegramBuildroomNotificationOptions,
): Promise<void> {
  const targets = resolveTelegramBuildroomNotificationTargets(opts.routes);
  const messages = formatTelegramBuildroomMessages(opts.text);
  for (const target of targets) {
    for (const message of messages) {
      await opts.sendText(target, message);
    }
  }
}
