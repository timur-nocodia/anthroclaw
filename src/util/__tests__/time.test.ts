import { describe, it, expect } from 'vitest';
import {
  nowInTimezone,
  formatHumanDateTimeRu,
  formatHumanDateTimeEn,
  formatIsoInTimezone,
  formatTimePrefix,
  formatDate,
  formatTime,
  dailyMemoryPath,
} from '../time.js';

describe('formatHumanDateTimeRu', () => {
  it('formats Russian weekday + time + date for a known instant', () => {
    const d = new Date('2026-02-05T07:31:00Z');
    expect(formatHumanDateTimeRu(d, 'Asia/Almaty')).toBe('Четверг, 12:31, 5 февраля 2026г.');
  });

  it('uses genitive month form (e.g. "5 февраля" not "февраль")', () => {
    const d = new Date('2026-02-05T10:00:00Z');
    const out = formatHumanDateTimeRu(d, 'UTC');
    expect(out).toMatch(/5 февраля 2026г\.$/);
  });

  it('capitalises Russian weekday', () => {
    const d = new Date('2026-02-08T12:31:00Z');
    const out = formatHumanDateTimeRu(d, 'UTC');
    expect(out.startsWith('Воскресенье,')).toBe(true);
  });

  it('respects timezone offset (NY is 5h behind UTC in winter)', () => {
    const d = new Date('2026-02-05T07:31:00Z');
    const out = formatHumanDateTimeRu(d, 'America/New_York');
    expect(out).toContain('02:31');
    expect(out).toContain('5 февраля');
  });

  it('handles UTC fallback', () => {
    const d = new Date('2026-02-05T07:31:00Z');
    expect(formatHumanDateTimeRu(d, 'UTC')).toBe('Четверг, 07:31, 5 февраля 2026г.');
  });
});

describe('nowInTimezone', () => {
  it('returns a Date whose container-local components reflect target-tz wall clock', () => {
    const d = nowInTimezone('UTC');
    const realUtc = new Date();
    const diffMin = Math.abs(d.getUTCMinutes() - realUtc.getUTCMinutes());
    expect(diffMin === 0 || diffMin === 1 || diffMin === 59).toBe(true);
  });

  it('produces components consistent with Intl for an arbitrary tz', () => {
    const d = nowInTimezone('Asia/Almaty');
    const expectedHour = Number(
      new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Almaty', hour: '2-digit', hourCycle: 'h23' })
        .formatToParts(new Date())
        .find((p) => p.type === 'hour')?.value,
    );
    const got = d.getHours();
    const ok = got === expectedHour || got === (expectedHour + 1) % 24 || got === (expectedHour + 23) % 24;
    expect(ok).toBe(true);
  });
});

describe('formatHumanDateTimeEn', () => {
  it('produces readable English with weekday + date', () => {
    const d = new Date('2026-02-05T07:31:00Z');
    expect(formatHumanDateTimeEn(d, 'Asia/Almaty')).toBe('Thursday, 12:31, 5 February 2026');
  });

  it('respects timezone offset', () => {
    const d = new Date('2026-02-05T07:31:00Z');
    expect(formatHumanDateTimeEn(d, 'UTC')).toBe('Thursday, 07:31, 5 February 2026');
  });
});

describe('formatIsoInTimezone', () => {
  it('produces YYYY-MM-DD HH:MM in target tz', () => {
    const d = new Date('2026-02-05T07:31:00Z');
    expect(formatIsoInTimezone(d, 'Asia/Almaty')).toBe('2026-02-05 12:31');
    expect(formatIsoInTimezone(d, 'UTC')).toBe('2026-02-05 07:31');
  });
});

describe('formatTimePrefix dispatcher', () => {
  const d = new Date('2026-02-05T07:31:00Z');

  it('"off" returns empty string', () => {
    expect(formatTimePrefix('off', d, 'Asia/Almaty')).toBe('');
  });

  it('"iso" wraps formatIsoInTimezone with brackets and tz', () => {
    expect(formatTimePrefix('iso', d, 'Asia/Almaty')).toBe('[2026-02-05 12:31 Asia/Almaty] ');
  });

  it('"human-ru" wraps formatHumanDateTimeRu with "Сейчас" prefix and tz suffix', () => {
    expect(formatTimePrefix('human-ru', d, 'Asia/Almaty')).toBe('[Сейчас Четверг, 12:31, 5 февраля 2026г. (Asia/Almaty)] ');
  });

  it('"human-en" wraps formatHumanDateTimeEn with "Now" prefix and tz suffix', () => {
    expect(formatTimePrefix('human-en', d, 'Asia/Almaty')).toBe('[Now Thursday, 12:31, 5 February 2026 (Asia/Almaty)] ');
  });
});

describe('formatDate / formatTime / dailyMemoryPath', () => {
  it('formatDate pads month and day', () => {
    const d = new Date(2026, 1, 5, 12, 31);
    expect(formatDate(d)).toBe('2026-02-05');
  });

  it('formatTime pads hour and minute', () => {
    const d = new Date(2026, 1, 5, 7, 3);
    expect(formatTime(d)).toBe('07:03');
  });

  it('dailyMemoryPath uses YYYY/MM/YYYY-MM-DD.md', () => {
    const d = new Date(2026, 1, 5);
    expect(dailyMemoryPath(d)).toBe('memory/2026/02/2026-02-05.md');
  });
});
