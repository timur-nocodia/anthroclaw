import type { BuildroomConfig } from '../config/model.js';
import { telegramBuildroomCommandToCliArgs } from './cli-adapter.js';
import {
  authorizeTelegramBuildroomCommand,
  type TelegramBuildroomCommandInput,
} from './operator-command.js';

export interface TelegramBuildroomCommandHandlerOptions {
  projectRoot: string;
  roomId: string;
  runCli: (
    argv: string[],
    io: { stdout: (text: string) => void; stderr: (text: string) => void },
  ) => Promise<number>;
}

export type TelegramBuildroomCommandHandlerResult =
  | { handled: false }
  | { handled: true; ok: true; exitCode: number; text: string }
  | { handled: true; ok: false; reason: string; text: string };

export async function handleTelegramBuildroomCommand(
  config: BuildroomConfig,
  input: TelegramBuildroomCommandInput,
  opts: TelegramBuildroomCommandHandlerOptions,
): Promise<TelegramBuildroomCommandHandlerResult> {
  const authorization = authorizeTelegramBuildroomCommand(config, input);
  if (!authorization.ok) {
    if (authorization.reason === 'not_buildroom_command') return { handled: false };
    return {
      handled: true,
      ok: false,
      reason: authorization.reason,
      text: rejectionMessage(authorization.reason),
    };
  }

  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCode = await opts.runCli(
    telegramBuildroomCommandToCliArgs(authorization, {
      projectRoot: opts.projectRoot,
      roomId: opts.roomId,
    }),
    {
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
    },
  );

  return {
    handled: true,
    ok: true,
    exitCode,
    text: [...stdout, ...stderr].join('\n').trim(),
  };
}

function rejectionMessage(reason: string): string {
  if (reason === 'unauthorized_operator') {
    return 'Buildroom command rejected: sender is not a configured operator.';
  }
  if (reason === 'unauthorized_route') {
    return 'Buildroom command rejected: route is not allowed for this command.';
  }
  return 'Buildroom command rejected: malformed /buildroom command.';
}
