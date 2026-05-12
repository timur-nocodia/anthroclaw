import type { BuildroomConfig } from '../config/model.js';

export type TelegramBuildroomCommand =
  | 'status'
  | 'show'
  | 'report'
  | 'collect'
  | 'propose'
  | 'review'
  | 'reject'
  | 'approve'
  | 'build'
  | 'qa'
  | 'trust'
  | 'pause'
  | 'resume';

export interface TelegramBuildroomCommandInput {
  text: string;
  telegramUserId: number;
  chatId: number;
  messageThreadId?: number | null;
  replyToMessageId?: number;
}

export type TelegramBuildroomCommandAuthorization =
  | {
      ok: true;
      command: TelegramBuildroomCommand;
      args: string[];
      operatorId: string;
      route: string;
      sourceThread: string | null;
    }
  | {
      ok: false;
      reason:
        | 'not_buildroom_command'
        | 'malformed_command'
        | 'unauthorized_operator'
        | 'unauthorized_route';
    };

const COMMANDS = new Set<TelegramBuildroomCommand>([
  'status',
  'show',
  'report',
  'collect',
  'propose',
  'review',
  'reject',
  'approve',
  'build',
  'qa',
  'trust',
  'pause',
  'resume',
]);

const APPROVAL_ROUTE_COMMANDS = new Set<TelegramBuildroomCommand>([
  'approve',
  'build',
  'pause',
  'resume',
]);

export function authorizeTelegramBuildroomCommand(
  config: BuildroomConfig,
  input: TelegramBuildroomCommandInput,
): TelegramBuildroomCommandAuthorization {
  const parsed = parseTelegramBuildroomCommand(input.text);
  if (parsed === 'malformed') return { ok: false, reason: 'malformed_command' };
  if (!parsed) return { ok: false, reason: 'not_buildroom_command' };
  if (!hasValidCommandArgs(parsed.command, parsed.args)) {
    return { ok: false, reason: 'malformed_command' };
  }

  const operatorId = `telegram_user:${input.telegramUserId}`;
  const operator = config.operators.find((candidate) => candidate.id === operatorId);
  if (!operator) return { ok: false, reason: 'unauthorized_operator' };

  const route = telegramRoute(input);
  const allowedRoutes = APPROVAL_ROUTE_COMMANDS.has(parsed.command)
    ? operator.approvalRoutes
    : operator.commandRoutes;
  if (!allowedRoutes.includes(route)) return { ok: false, reason: 'unauthorized_route' };

  return {
    ok: true,
    command: parsed.command,
    args: parsed.args,
    operatorId,
    route,
    sourceThread: input.messageThreadId == null ? null : route,
  };
}

function parseTelegramBuildroomCommand(
  text: string,
): { command: TelegramBuildroomCommand; args: string[] } | 'malformed' | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/buildroom')) return null;

  const parts = trimmed.split(/\s+/);
  if (!isBuildroomSlashCommand(parts[0])) return null;
  const command = parts[1];
  if (!COMMANDS.has(command as TelegramBuildroomCommand)) return 'malformed';
  return {
    command: command as TelegramBuildroomCommand,
    args: parts.slice(2),
  };
}

function isBuildroomSlashCommand(token: string): boolean {
  return token === '/buildroom' || /^\/buildroom@[A-Za-z0-9_]+$/.test(token);
}

function hasValidCommandArgs(command: TelegramBuildroomCommand, args: string[]): boolean {
  if (command === 'approve') {
    return args.length === 1 && args[0].startsWith('review_');
  }
  if (command === 'build') {
    return args.length === 1 && (
      args[0].startsWith('approval_') ||
      args[0].startsWith('plan_')
    );
  }
  return true;
}

function telegramRoute(input: TelegramBuildroomCommandInput): string {
  return input.messageThreadId == null
    ? `telegram_chat:${input.chatId}`
    : `telegram_thread:${input.chatId}:${input.messageThreadId}`;
}
