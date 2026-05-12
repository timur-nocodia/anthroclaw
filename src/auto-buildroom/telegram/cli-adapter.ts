import type { TelegramBuildroomCommandAuthorization } from './operator-command.js';

export interface TelegramBuildroomCliArgsOptions {
  projectRoot: string;
  roomId: string;
}

export function telegramBuildroomCommandToCliArgs(
  command: TelegramBuildroomCommandAuthorization & { ok: true },
  opts: TelegramBuildroomCliArgsOptions,
): string[] {
  return [
    command.command,
    ...command.args,
    ...(command.command === 'build' ? ['--execute'] : []),
    '--root',
    opts.projectRoot,
    '--room',
    opts.roomId,
    '--operator',
    command.operatorId,
  ];
}
