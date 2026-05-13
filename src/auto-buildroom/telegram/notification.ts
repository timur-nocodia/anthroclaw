export interface TelegramBuildroomNotificationTarget {
  route: string;
  chatId: number;
  messageThreadId: number | null;
}

export function resolveTelegramBuildroomNotificationTargets(
  routes: string[],
): TelegramBuildroomNotificationTarget[] {
  return routes.flatMap((route) => {
    const parsed = parseTelegramNotificationRoute(route);
    return parsed ? [parsed] : [];
  });
}

function parseTelegramNotificationRoute(route: string): TelegramBuildroomNotificationTarget | null {
  const chatPrefix = 'telegram_chat:';
  if (route.startsWith(chatPrefix)) {
    const chatId = parseTelegramIntegerId(route.slice(chatPrefix.length));
    if (chatId == null) return null;
    return { route, chatId, messageThreadId: null };
  }

  const threadPrefix = 'telegram_thread:';
  if (!route.startsWith(threadPrefix)) return null;

  const parts = route.slice(threadPrefix.length).split(':');
  if (parts.length !== 2) return null;
  const chatId = parseTelegramIntegerId(parts[0]);
  const messageThreadId = parseTelegramIntegerId(parts[1]);
  if (chatId == null || messageThreadId == null) return null;
  return { route, chatId, messageThreadId };
}

function parseTelegramIntegerId(value: string): number | null {
  if (!/^-?\d+$/.test(value)) return null;
  return Number(value);
}
