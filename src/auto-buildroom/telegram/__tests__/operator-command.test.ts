import { describe, expect, it } from 'vitest';
import { createDefaultBuildroomConfig } from '../../config/model.js';
import { authorizeTelegramBuildroomCommand } from '../operator-command.js';

describe('Telegram Buildroom operator commands', () => {
  it('authorizes exact approval commands by Telegram user identity and approval route', () => {
    const config = createDefaultBuildroomConfig({
      roomId: 'anthroclaw-core',
      operatorId: 'telegram_user:48705953',
    });
    config.operators[0].commandRoutes = ['telegram_chat:-1003931616911'];
    config.operators[0].approvalRoutes = ['telegram_chat:-1003931616911'];

    const result = authorizeTelegramBuildroomCommand(config, {
      text: '/buildroom approve review_20260512_docs',
      telegramUserId: 48705953,
      chatId: -1003931616911,
    });

    expect(result).toMatchObject({
      ok: true,
      command: 'approve',
      args: ['review_20260512_docs'],
      operatorId: 'telegram_user:48705953',
      route: 'telegram_chat:-1003931616911',
      sourceThread: null,
    });
  });

  it('rejects approval from chat route alone when Telegram user is not configured', () => {
    const config = createDefaultBuildroomConfig({
      roomId: 'anthroclaw-core',
      operatorId: 'telegram_user:48705953',
    });
    config.operators[0].approvalRoutes = ['telegram_chat:-1003931616911'];

    const result = authorizeTelegramBuildroomCommand(config, {
      text: '/buildroom approve review_20260512_docs',
      telegramUserId: 111,
      chatId: -1003931616911,
    });

    expect(result).toEqual({ ok: false, reason: 'unauthorized_operator' });
  });

  it('rejects approval from a notification thread that is not an approval route', () => {
    const config = createDefaultBuildroomConfig({
      roomId: 'anthroclaw-core',
      operatorId: 'telegram_user:48705953',
    });
    config.operators[0].commandRoutes = ['telegram_thread:-1003931616911:2'];
    config.operators[0].approvalRoutes = ['telegram_chat:-1003931616911'];

    const result = authorizeTelegramBuildroomCommand(config, {
      text: '/buildroom approve review_20260512_docs',
      telegramUserId: 48705953,
      chatId: -1003931616911,
      messageThreadId: 2,
    });

    expect(result).toEqual({ ok: false, reason: 'unauthorized_route' });
  });

  it('does not treat ordinary replies or short words as Buildroom commands', () => {
    const config = createDefaultBuildroomConfig({
      roomId: 'anthroclaw-core',
      operatorId: 'telegram_user:48705953',
    });

    expect(authorizeTelegramBuildroomCommand(config, {
      text: 'yes',
      telegramUserId: 48705953,
      chatId: -1003931616911,
      replyToMessageId: 123,
    })).toEqual({ ok: false, reason: 'not_buildroom_command' });
  });

  it('classifies incomplete Buildroom slash commands as malformed', () => {
    const config = createDefaultBuildroomConfig({
      roomId: 'anthroclaw-core',
      operatorId: 'telegram_user:48705953',
    });

    expect(authorizeTelegramBuildroomCommand(config, {
      text: '/buildroom',
      telegramUserId: 48705953,
      chatId: -1003931616911,
    })).toEqual({ ok: false, reason: 'malformed_command' });
  });

  it('accepts Telegram bot-suffixed slash commands in groups', () => {
    const config = createDefaultBuildroomConfig({
      roomId: 'anthroclaw-core',
      operatorId: 'telegram_user:48705953',
    });
    config.operators[0].commandRoutes = ['telegram_thread:-1003931616911:2'];

    const result = authorizeTelegramBuildroomCommand(config, {
      text: '/buildroom@anthroclaw_bot status',
      telegramUserId: 48705953,
      chatId: -1003931616911,
      messageThreadId: 2,
    });

    expect(result).toMatchObject({
      ok: true,
      command: 'status',
      route: 'telegram_thread:-1003931616911:2',
      sourceThread: 'telegram_thread:-1003931616911:2',
    });
  });
});
