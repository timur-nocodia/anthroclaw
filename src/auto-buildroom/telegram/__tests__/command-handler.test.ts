import { describe, expect, it, vi } from 'vitest';
import { createDefaultBuildroomConfig } from '../../config/model.js';
import {
  formatTelegramBuildroomMessages,
  handleTelegramBuildroomCommand,
} from '../command-handler.js';

describe('Telegram Buildroom command handler', () => {
  it('runs authorized Telegram commands through the canonical CLI argument path', async () => {
    const config = createDefaultBuildroomConfig({
      roomId: 'anthroclaw-core',
      operatorId: 'telegram_user:48705953',
    });
    config.operators[0].commandRoutes = ['telegram_chat:-1003931616911'];
    const runCli = vi.fn(async (_argv: string[], io: { stdout: (text: string) => void }) => {
      io.stdout('Buildroom: anthroclaw-core');
      return 0;
    });

    const result = await handleTelegramBuildroomCommand(config, {
      text: '/buildroom status',
      telegramUserId: 48705953,
      chatId: -1003931616911,
    }, {
      projectRoot: '/repo',
      roomId: 'anthroclaw-core',
      runCli,
    });

    expect(result).toEqual({
      handled: true,
      ok: true,
      exitCode: 0,
      text: 'Buildroom: anthroclaw-core',
      messages: ['Buildroom: anthroclaw-core'],
    });
    expect(runCli).toHaveBeenCalledWith([
      'status',
      '--root',
      '/repo',
      '--room',
      'anthroclaw-core',
      '--operator',
      'telegram_user:48705953',
    ], expect.anything());
  });

  it('rejects unauthorized Telegram commands without invoking CLI or revealing artifact existence', async () => {
    const config = createDefaultBuildroomConfig({
      roomId: 'anthroclaw-core',
      operatorId: 'telegram_user:48705953',
    });
    config.operators[0].approvalRoutes = ['telegram_chat:-1003931616911'];
    const runCli = vi.fn();

    const result = await handleTelegramBuildroomCommand(config, {
      text: '/buildroom approve review_20260512_docs',
      telegramUserId: 111,
      chatId: -1003931616911,
    }, {
      projectRoot: '/repo',
      roomId: 'anthroclaw-core',
      runCli,
    });

    expect(result).toEqual({
      handled: true,
      ok: false,
      reason: 'unauthorized_operator',
      text: 'Buildroom command rejected: sender is not a configured operator.',
    });
    expect(result.handled && !result.ok ? result.text : '').not.toContain('review_20260512_docs');
    expect(runCli).not.toHaveBeenCalled();
  });

  it('ignores ordinary chat text so agent routing can continue', async () => {
    const config = createDefaultBuildroomConfig({
      roomId: 'anthroclaw-core',
      operatorId: 'telegram_user:48705953',
    });

    const result = await handleTelegramBuildroomCommand(config, {
      text: 'yes',
      telegramUserId: 48705953,
      chatId: -1003931616911,
    }, {
      projectRoot: '/repo',
      roomId: 'anthroclaw-core',
      runCli: vi.fn(),
    });

    expect(result).toEqual({ handled: false });
  });

  it('returns CLI stderr when an authorized command fails', async () => {
    const config = createDefaultBuildroomConfig({
      roomId: 'anthroclaw-core',
      operatorId: 'telegram_user:48705953',
    });
    config.operators[0].commandRoutes = ['telegram_chat:-1003931616911'];
    const runCli = vi.fn(async (_argv: string[], io: { stderr: (text: string) => void }) => {
      io.stderr('Artifact not found: trust_20260512_docs');
      return 5;
    });

    const result = await handleTelegramBuildroomCommand(config, {
      text: '/buildroom show trust_20260512_docs',
      telegramUserId: 48705953,
      chatId: -1003931616911,
    }, {
      projectRoot: '/repo',
      roomId: 'anthroclaw-core',
      runCli,
    });

    expect(result).toEqual({
      handled: true,
      ok: true,
      exitCode: 5,
      text: 'Artifact not found: trust_20260512_docs',
      messages: ['Artifact not found: trust_20260512_docs'],
    });
  });

  it('splits long Telegram Buildroom responses into bounded message chunks', () => {
    const chunks = formatTelegramBuildroomMessages('a'.repeat(6500), 3000);

    expect(chunks).toHaveLength(3);
    expect(chunks.every((chunk) => chunk.length <= 3000)).toBe(true);
    expect(chunks.join('')).toBe('a'.repeat(6500));
  });
});
