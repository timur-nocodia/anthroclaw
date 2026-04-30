import { describe, expect, it } from 'vitest';
import {
  buildRuntimeReminderId,
  extractRuntimeReminderMessage,
  formatReminderText,
  formatRuntimeReminderAck,
  formatRuntimeReminderPrompt,
  formatRuntimeReminderStatus,
  isRuntimeReminderJobId,
  isRuntimeReminderStatusQuery,
  parseRuntimeReminderFireAt,
  parseRuntimeReminderIntent,
  stripRuntimeReminderJobId,
} from '../../src/cron/reminder-primitive.js';

describe('runtime reminder primitive', () => {
  const timezone = 'Asia/Almaty';

  it('parses relative Russian reminder requests', () => {
    const intent = parseRuntimeReminderIntent(
      'Поставь тестовое напоминание через 3 минуты: проверяем cron target repair',
      { timezone, nowMs: Date.parse('2026-04-30T11:55:00Z') },
    );

    expect(intent).not.toBeNull();
    expect(intent?.fireAt.toISOString()).toBe('2026-04-30T11:58:00.000Z');
    expect(intent?.schedule).toBe('58 11 30 4 *');
    expect(intent?.message).toBe('проверяем cron target repair');
  });

  it('extracts payload after "о том, что"', () => {
    const intent = parseRuntimeReminderIntent(
      'Поставь мне напоминание через 10 минут о том, что мы проверяем крон.',
      { timezone, nowMs: Date.parse('2026-04-30T10:59:00Z') },
    );

    expect(intent?.fireAt.toISOString()).toBe('2026-04-30T11:09:00.000Z');
    expect(intent?.schedule).toBe('9 11 30 4 *');
    expect(intent?.message).toBe('мы проверяем крон');
  });

  it('parses absolute local time and converts it to UTC cron fields', () => {
    const intent = parseRuntimeReminderIntent(
      'Напомни в 16:09 проверить крон',
      { timezone, nowMs: Date.parse('2026-04-30T10:59:00Z') },
    );

    expect(intent?.fireAt.toISOString()).toBe('2026-04-30T11:09:00.000Z');
    expect(intent?.schedule).toBe('9 11 30 4 *');
    expect(intent?.message).toBe('проверить крон');
  });

  it('moves past same-day absolute time to tomorrow', () => {
    const intent = parseRuntimeReminderIntent(
      'Напомни в 16:09 проверить крон',
      { timezone, nowMs: Date.parse('2026-04-30T11:30:00Z') },
    );

    expect(intent?.fireAt.toISOString()).toBe('2026-05-01T11:09:00.000Z');
    expect(intent?.schedule).toBe('9 11 1 5 *');
  });

  it('does not intercept unrelated messages', () => {
    expect(parseRuntimeReminderIntent('как работает cron target repair?', { timezone })).toBeNull();
  });

  it('formats prompt, text, ack, and ids', () => {
    const intent = parseRuntimeReminderIntent(
      'Напомни через 1 минуту проверить крон',
      { timezone, nowMs: Date.parse('2026-04-30T11:55:00Z') },
    )!;

    expect(formatReminderText(intent.message)).toBe('⏰ Напоминание: проверить крон');
    expect(formatRuntimeReminderPrompt(intent.message)).toBe(
      'Return exactly this reminder text and nothing else: "⏰ Напоминание: проверить крон"',
    );
    expect(extractRuntimeReminderMessage(formatRuntimeReminderPrompt(intent.message))).toBe('проверить крон');
    expect(formatRuntimeReminderAck(intent, timezone, Date.parse('2026-04-30T11:55:00Z'))).toBe(
      'Готово. Напомню в 16:56: проверить крон',
    );
    expect(buildRuntimeReminderId(intent.fireAt, 'abc-123_456')).toBe('runtime-reminder-202604301156-abc12345');
  });

  it('recognizes runtime reminder IDs and status queries', () => {
    expect(isRuntimeReminderJobId('runtime-reminder-202604301156-abc12345')).toBe(true);
    expect(isRuntimeReminderJobId('dyn:runtime-reminder-202604301156-abc12345')).toBe(true);
    expect(stripRuntimeReminderJobId('dyn:runtime-reminder-202604301156-abc12345')).toBe(
      'runtime-reminder-202604301156-abc12345',
    );
    expect(parseRuntimeReminderFireAt('dyn:runtime-reminder-202604301156-abc12345')?.toISOString()).toBe(
      '2026-04-30T11:56:00.000Z',
    );
    expect(isRuntimeReminderStatusQuery('жду')).toBe(true);
    expect(isRuntimeReminderStatusQuery('как работает cron?')).toBe(false);
  });

  it('formats pending runtime reminder status', () => {
    expect(formatRuntimeReminderStatus([
      {
        id: 'runtime-reminder-202604301156-abc12345',
        fireAt: new Date('2026-04-30T11:56:00.000Z'),
        message: 'проверить крон',
      },
    ], timezone, Date.parse('2026-04-30T11:55:00Z'))).toBe(
      'Напоминание уже создано кодом. Ждем 16:56: проверить крон',
    );
  });
});
